'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { Resend } from 'resend';
import { appendAuditEvent } from '@/app/lib/audit';
import { ERASED_CUSTOMER_NAME, erasedEmailFor, erasureConfirmed, isErasedEmail } from '@/app/lib/customer-erasure';
import { hashPassword } from '@/app/lib/password';
import { verifySession } from '@/app/lib/session';
import { runSerializableWithRetry } from '@/app/services/booking-service';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { getActionT } from '@/i18n/request';

export type EraseCustomerResult = { success: true; message: string } | { success: false; error: string };

type Refusal = 'NOT_FOUND' | 'ERASE_ADMIN' | 'ALREADY_ERASED' | 'CONFIRMATION_MISMATCH' | 'HAS_UPCOMING';
type Outcome = { refused: Refusal; count?: number } | { erasedEmail: string };

/** The account changed between the read and the anonymising write. */
class ErasureRaced extends Error {}

/**
 * Honour a customer's erasure request (UK GDPR art. 17) from Admin -> Users.
 * Procedure, and what is kept and why: docs/data-erasure.md.
 *
 * The User row itself stays — deleting it would cascade away the appointment
 * history the salon must keep as business records — but everything that
 * identifies the person goes, in one transaction: name, email (moved to an
 * undeliverable address, so nothing is ever mailed to it again), phone,
 * password (replaced by a hash of a secret nobody holds), verification,
 * language, MFA material, every session (version bump), linked Google
 * sign-in, reset links, the free-text notes on their bookings and every copy
 * of them held in the notification outbox. Their reviews are deleted: the
 * privacy notice keeps a review only while the account is open, and its text
 * (with the visit's date, service and stylist) can identify the person.
 *
 * Refused for administrators, for the acting admin, and while the customer has
 * an upcoming PENDING/CONFIRMED booking (staff cancel those first, so no
 * appointment is left without a way to reach the customer). The typed
 * confirmation is their address, or ERASE when they never gave one.
 */
export async function eraseCustomerData(userId: string, confirmation: string): Promise<EraseCustomerResult> {
  const t = await getActionT('adminOps');
  const refuse = (code: string, params?: { count: number }): EraseCustomerResult =>
    ({ success: false, error: t.dynamic(`users.erasure.errors.${code}`, params, t('users.erasure.errors.FAILED')) });
  const session = await verifySession();
  if (session.role !== 'ADMIN') return refuse('UNAUTHORIZED');
  if (typeof userId !== 'string' || !userId || typeof confirmation !== 'string' || !confirmation.trim()) return refuse('INVALID');
  if (userId === session.userId) return refuse('ERASE_SELF');

  // bcrypt is slow: prepare the unusable replacement before the transaction.
  const unusablePassword = await hashPassword(randomBytes(32).toString('base64url'));
  const now = new Date();
  let outcome: Outcome;
  try {
    outcome = await runSerializableWithRetry(async (tx): Promise<Outcome> => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } });
      if (!user) return { refused: 'NOT_FOUND' };
      if (user.role !== 'USER') return { refused: 'ERASE_ADMIN' };
      if (isErasedEmail(user.email)) return { refused: 'ALREADY_ERASED' };
      if (!erasureConfirmed(confirmation, user.email)) return { refused: 'CONFIRMATION_MISMATCH' };
      const upcoming = await tx.appointment.count({ where: { userId, status: { in: ['PENDING', 'CONFIRMED'] }, date: { gt: now } } });
      if (upcoming > 0) return { refused: 'HAS_UPCOMING', count: upcoming };

      const anonymised = await tx.user.updateMany({
        where: { id: userId, role: 'USER', email: user.email },
        data: {
          name: ERASED_CUSTOMER_NAME,
          email: erasedEmailFor(userId),
          phone: null,
          password: unusablePassword,
          emailVerifiedAt: null,
          preferredLocale: null,
          sessionVersion: { increment: 1 },
          mfaSecretEncrypted: null,
          mfaEnabledAt: null,
          mfaLastUsedStep: null,
          mfaRecoveryCodesJson: '[]',
          mfaPendingSecretEncrypted: null,
          mfaPendingExpiresAt: null,
        },
      });
      if (anonymised.count !== 1) throw new ErasureRaced();
      const linkedAccounts = await tx.oAuthAccount.deleteMany({ where: { userId } });
      // Email-verification links are signed tokens bound to the old address
      // (lib/email-verification.ts), so the address change above voids them.
      const resetLinks = await tx.passwordResetToken.deleteMany({ where: { userId } });

      // Appointments are business records and stay; their free text does not.
      const appointmentIds = (await tx.appointment.findMany({ where: { userId }, select: { id: true } })).map((row) => row.id);
      await tx.appointment.updateMany({ where: { userId }, data: { notes: null, notificationLocale: null } });
      let notifications = 0;
      if (appointmentIds.length > 0) {
        // Unsent mail never goes out: SKIPPED is never picked up again, and a
        // worker holding the lease loses it (its later writes match no row).
        const stopped = await tx.notificationDelivery.updateMany({
          where: { appointmentId: { in: appointmentIds }, status: { in: ['PENDING', 'PROCESSING'] } },
          data: { status: 'SKIPPED', payloadJson: '{}', lockedAt: null, lockToken: null, lastError: 'Customer data erased; never sent.' },
        });
        // Sent and failed history keeps its status for the delivery log, minus the personal copy.
        const redacted = await tx.notificationDelivery.updateMany({
          where: { appointmentId: { in: appointmentIds }, payloadJson: { not: '{}' } },
          data: { payloadJson: '{}' },
        });
        notifications = stopped.count + redacted.count;
      }
      // Published reviews go with the account (privacy notice: kept while the account is open).
      const reviews = (await tx.review.deleteMany({ where: { userId } })).count;
      // Counts only: the audit trail must not become a copy of what was erased.
      await appendAuditEvent({
        actorUserId: session.userId, action: 'USER.ERASED', targetType: 'User', targetId: userId,
        metadata: { appointments: appointmentIds.length, notifications, linkedAccounts: linkedAccounts.count, resetLinks: resetLinks.count, reviews },
      }, tx);
      return { erasedEmail: user.email };
    });
  } catch (error) {
    if (error instanceof ErasureRaced) return refuse('CHANGED');
    console.error('Customer erasure failed:', error instanceof Error ? error.name : 'unknown');
    return refuse('FAILED');
  }
  if ('refused' in outcome) return refuse(outcome.refused, outcome.count === undefined ? undefined : { count: outcome.count });

  revalidateAllLocales(revalidatePath, '/admin/users');
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/admin/reviews');
  // The public reviews page names review authors.
  revalidateAllLocales(revalidatePath, '/reviews');

  const marketing = await removeFromMarketingAudience(outcome.erasedEmail);
  return marketing === 'failed'
    ? { success: true, message: t('users.erasure.doneMarketingManual', { email: outcome.erasedEmail }) }
    : { success: true, message: t('users.erasure.done') };
}

/**
 * The marketing list lives in a Resend audience, not in our database. Best
 * effort, after the erasure has committed: a failure only asks the admin to
 * remove the address by hand. No audience configured means no list to clean.
 */
async function removeFromMarketingAudience(email: string): Promise<'removed' | 'not-configured' | 'failed'> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const audienceId = process.env.RESEND_AUDIENCE_ID?.trim();
  if (!apiKey || !audienceId) return 'not-configured';
  try {
    const { error } = await new Resend(apiKey).contacts.remove({ email, audienceId });
    // Never on the list (or already removed): nothing to erase there.
    if (!error || error.statusCode === 404 || /not.?found|does not exist|could not find/i.test(error.message ?? '')) return 'removed';
    console.error('Removing an erased customer from the marketing audience failed:', error.statusCode ?? 'unknown');
    return 'failed';
  } catch (error) {
    console.error('Removing an erased customer from the marketing audience failed:', error instanceof Error ? error.name : 'unknown');
    return 'failed';
  }
}
