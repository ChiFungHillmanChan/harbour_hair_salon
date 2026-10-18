'use server';

import { appendAuditEvent } from '@/app/lib/audit';
import { revalidateAllLocales } from '@/i18n/revalidate';
import prisma from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import { verifySession } from '@/app/lib/session';
import { revalidatePath, updateTag } from 'next/cache';
import { after } from 'next/server';
import { invalidateStylistIcalFeed, scheduleGoogleCalendarPush } from '@/app/services/stylist-ical-cache';
import { fitsBcryptLimit, hashPassword } from '@/app/lib/password';
import { z } from 'zod';
import { revalidateCategoryPages } from '@/app/actions/admin-services';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from '@/app/services/treatwell-api';
import { enqueueAppointmentNotification, dispatchAppointmentNotifications } from '@/app/services/notification-outbox-service';
import { checkCalendarBookingReadiness } from '@/app/services/integration-readiness';
import { refreshCalendarFeedsBeforeApproval } from '@/app/services/calendar-sync-service';
import { assertAppointmentSlotAvailable, getValidPatchTest, runSerializableWithRetry } from '@/app/services/booking-service';
import { isRescheduleRequestMoot } from '@/app/lib/reschedule-request';
import { hasAppointmentStarted } from '@/app/lib/appointment-timing';
import { isRequestLapseNoticeDue, readSalonPhoneForLapseNotice } from '@/app/services/request-lapse-notice';
import { BookingError, bookingErrorText, describeBookingError } from '@/app/services/booking-errors';
import { isDepositRefundableOnCancel } from '@/app/lib/booking-constants';
import {
  approvalStep, claimDepositForCapture, depositGatewayFor, loadLinkedDeposit, markDepositCaptured, NO_DEPOSIT,
  planDepositForClosing, recordDepositTakenNotConfirmed, settleDepositAfterCommit, settleDepositBeforeClosing, submitDepositRefund,
  takeDeposit, type ApprovalStep, type LinkedDeposit,
} from '@/app/services/deposit-lifecycle';
import { formatGBP } from '@/app/services/pricing/money';
import { describeFault } from '@/app/lib/fault';
import { HTML_LANG } from '@/i18n/config';
import { getActionLocale } from '@/i18n/request';
import { translator } from '@/i18n/messages';
import { ContentError, createPublished, deleteContent } from '@/app/services/content/drafts';

// --- Validation Schemas ---

// Messages are codes, translated by promotionError() below.
const discountCodeSchema = z.object({
  code: z.string('CODE_REQUIRED').min(1, 'CODE_REQUIRED').toUpperCase(),
  type: z.enum(['PERCENTAGE', 'FIXED'], 'TYPE'),
  value: z.coerce.number('VALUE_POSITIVE').positive('VALUE_POSITIVE'),
  maxUses: z.coerce.number('MAX_USES').int('MAX_USES').positive('MAX_USES').nullable().optional(),
  expiresAt: z.coerce.date('EXPIRES').nullable().optional(),
}).refine(
  (data) => data.type !== 'PERCENTAGE' || data.value <= 100,
  { message: 'PERCENT_MAX', path: ['value'] }
);

// An offer's title and description are bilingual content (created with both
// languages via createPublished, edited as a draft in actions/admin-content);
// the discount itself is operational and saves immediately.
const offerSchema = z.object({
  discountType: z.enum(['PERCENTAGE', 'FIXED'], 'TYPE'),
  discountValue: z.coerce.number('VALUE_POSITIVE').positive('VALUE_POSITIVE'),
  isGlobal: z.boolean().optional(),
}).refine(
  (data) => data.discountType !== 'PERCENTAGE' || data.discountValue <= 100,
  { message: 'PERCENT_MAX', path: ['discountValue'] }
);

// Same `{ error?, success? }` shape resetUserPassword below already returns —
// used here so OfferForm/OfferInlineEditor/DiscountForm can surface errors via
// useActionState instead of silently discarding them.
export type OfferActionState = { error?: string; success?: boolean };
export type DiscountActionState = { error?: string; success?: boolean };
export type AdminUserActionState = { error?: string; success?: boolean };

// Messages are codes, translated by adminUserError() below. The email is stored
// trimmed and lower-case — the form sign-in looks it up in (actions/auth.ts) —
// or an address typed with capitals could never sign in.
const adminUserSchema = z.object({
  name: z.string('NAME_TOO_SHORT').min(2, 'NAME_TOO_SHORT').max(100, 'NAME_TOO_LONG'),
  email: z.string('EMAIL_INVALID').trim().toLowerCase().email('EMAIL_INVALID').max(254, 'EMAIL_TOO_LONG'),
  password: z.string('PASSWORD_TOO_SHORT').min(8, 'PASSWORD_TOO_SHORT').refine(fitsBcryptLimit, { message: 'PASSWORD_TOO_LONG' }),
});

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    return { error: 'Unauthorized', session: null };
  }
  return { error: null, session };
}

// --- Discount Codes ---

/**
 * Offer and discount-code errors in the admin's language. The records stay
 * fully manageable while discounts are paused (pricing/policy.ts
 * DISCOUNTS_PAUSED); only their use in new quotes is switched off.
 */
async function promotionError(code: string): Promise<string> {
  const t = translator(await getActionLocale(), 'adminContent');
  return t.dynamic(`promotions.errors.${code}`, undefined, t('promotions.errors.GENERIC'));
}

export async function createDiscountCode(
  _prevState: DiscountActionState,
  formData: FormData
): Promise<DiscountActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await promotionError('UNAUTHORISED') };

  const parsed = discountCodeSchema.safeParse({
    code: formData.get('code'),
    type: formData.get('type'),
    value: formData.get('value'),
    maxUses: formData.get('maxUses') || null,
    expiresAt: formData.get('expiresAt') || null,
  });

  if (!parsed.success) {
    return { error: await promotionError(parsed.error.issues[0].message) };
  }

  try {
    await prisma.discountCode.create({
      data: {
        code: parsed.data.code,
        type: parsed.data.type,
        value: parsed.data.value,
        maxUses: parsed.data.maxUses ?? null,
        expiresAt: parsed.data.expiresAt ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: await promotionError('CODE_TAKEN') };
    }
    console.error('createDiscountCode failed:', error);
    return { error: await promotionError('CODE_CREATE_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/discounts');
  return { success: true };
}

export async function deleteDiscountCode(id: string): Promise<DiscountActionState> {
  const { error } = await requireAdmin();
  if (error) return { error: await promotionError('UNAUTHORISED') };

  try {
    // Check if any appointments use this code
    const usageCount = await prisma.appointment.count({
      where: { discountCodeId: id },
    });

    if (usageCount > 0) {
      // Deactivate instead of deleting
      await prisma.discountCode.update({
        where: { id },
        data: { isActive: false },
      });
    } else {
      await prisma.discountCode.delete({
        where: { id },
      });
    }
  } catch (error) {
    console.error('deleteDiscountCode failed:', error);
    return { error: await promotionError('CODE_DELETE_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/discounts');
  return { success: true };
}

/**
 * Flips a code between active and inactive. Deleting a code that has already
 * been redeemed only deactivates it (see above) and its `code` stays taken by
 * the unique index, so without this the salon could never bring a seasonal code
 * back — they had to invent a new one. Reversible, so no confirm prompt.
 */
export async function toggleDiscountCodeStatus(
  id: string,
  isActive: boolean
): Promise<DiscountActionState> {
  const { error } = await requireAdmin();
  if (error) return { error: await promotionError('UNAUTHORISED') };

  try {
    await prisma.discountCode.update({
      where: { id },
      data: { isActive },
    });
  } catch (error) {
    console.error('toggleDiscountCodeStatus failed:', error);
    return { error: await promotionError(isActive ? 'CODE_ACTIVATE_FAILED' : 'CODE_DEACTIVATE_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/discounts');
  return { success: true };
}

// --- Offers ---

export async function createOffer(
  _prevState: OfferActionState,
  formData: FormData
): Promise<OfferActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await promotionError('UNAUTHORISED') };

  const parsed = offerSchema.safeParse({
    discountType: formData.get('discountType'),
    discountValue: formData.get('discountValue'),
    isGlobal: formData.get('isGlobal') === 'on',
  });

  if (!parsed.success) {
    return { error: await promotionError(parsed.error.issues[0].message) };
  }

  let contentFields: unknown = null;
  try {
    contentFields = JSON.parse(String(formData.get('contentJson') ?? 'null'));
  } catch {
    return { error: await promotionError('OFFER_CONTENT') };
  }

  // A new offer goes live only with its title (and description) in both
  // languages, confirmed proofread — never English-only.
  try {
    await prisma.$transaction((tx) => createPublished(
      tx,
      'OFFER',
      { fields: contentFields, confirmedReviewed: formData.get('contentReviewed') === 'on', adminId: session.userId },
      (english) => tx.offer.create({
        data: {
          title: typeof english.title === 'string' ? english.title : '',
          description: typeof english.description === 'string' && english.description.trim() ? english.description : null,
          discountType: parsed.data.discountType,
          discountValue: parsed.data.discountValue,
          isActive: true,
          isGlobal: parsed.data.isGlobal ?? false,
        },
        select: { id: true },
      }),
    ));
  } catch (error) {
    if (error instanceof ContentError) return { error: await promotionError('OFFER_CONTENT') };
    console.error('createOffer failed:', error);
    return { error: await promotionError('OFFER_CREATE_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/offers');
  updateTag('active-offers');
  revalidateAllLocales(revalidatePath, '/offers');
  revalidateAllLocales(revalidatePath, '/');
  revalidateAllLocales(revalidatePath, '/services');
  await revalidateCategoryPages();

  return { success: true };
}

export async function updateOffer(
  _prevState: OfferActionState,
  formData: FormData
): Promise<OfferActionState> {
  const { error } = await requireAdmin();
  if (error) return { error: await promotionError('UNAUTHORISED') };

  const id = formData.get('id');
  if (typeof id !== 'string' || !id) {
    return { error: await promotionError('OFFER_MISSING_ID') };
  }

  const existing = await prisma.offer.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { error: await promotionError('OFFER_NOT_FOUND') };

  // Discount settings only; the title and description are drafted separately.
  const parsed = offerSchema.safeParse({
    discountType: formData.get('discountType'),
    discountValue: formData.get('discountValue'),
    isGlobal: formData.get('isGlobal') === 'on',
  });

  if (!parsed.success) {
    return { error: await promotionError(parsed.error.issues[0].message) };
  }

  try {
    await prisma.offer.update({
      where: { id },
      data: {
        discountType: parsed.data.discountType,
        discountValue: parsed.data.discountValue,
        isGlobal: parsed.data.isGlobal ?? false,
      },
    });
  } catch (error) {
    console.error('updateOffer failed:', error);
    return { error: await promotionError('OFFER_UPDATE_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/offers');
  updateTag('active-offers');
  revalidateAllLocales(revalidatePath, '/offers');
  revalidateAllLocales(revalidatePath, '/');
  revalidateAllLocales(revalidatePath, '/services');
  await revalidateCategoryPages();

  return { success: true };
}

export async function toggleOfferStatus(id: string, isActive: boolean): Promise<OfferActionState> {
  const { error } = await requireAdmin();
  if (error) return { error: await promotionError('UNAUTHORISED') };

  try {
    await prisma.offer.update({
      where: { id },
      data: { isActive },
    });
  } catch (error) {
    console.error('toggleOfferStatus failed:', error);
    return { error: await promotionError('OFFER_STATUS_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/offers');
  updateTag('active-offers');
  revalidateAllLocales(revalidatePath, '/offers');
  revalidateAllLocales(revalidatePath, '/');
  revalidateAllLocales(revalidatePath, '/services');
  await revalidateCategoryPages();
  return { success: true };
}

export async function deleteOffer(id: string): Promise<OfferActionState> {
  const { error } = await requireAdmin();
  if (error) return { error: await promotionError('UNAUTHORISED') };

  try {
    await prisma.$transaction(async (tx) => {
      await deleteContent(tx, 'OFFER', id);
      await tx.offer.delete({ where: { id } });
    });
  } catch (error) {
    console.error('deleteOffer failed:', error);
    return { error: await promotionError('OFFER_DELETE_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/offers');
  updateTag('active-offers');
  revalidateAllLocales(revalidatePath, '/offers');
  revalidateAllLocales(revalidatePath, '/');
  revalidateAllLocales(revalidatePath, '/services');
  await revalidateCategoryPages();
  return { success: true };
}

// --- Admin Users ---

/** Admin-account errors in the admin's language, addressed by stable code. */
async function adminUserError(code: string, params?: { count: number }): Promise<string> {
  const t = translator(await getActionLocale(), 'adminOps');
  return t.dynamic(`users.errors.${code}`, params, t('users.errors.INVALID'));
}

export async function createAdminUser(
  _prevState: AdminUserActionState,
  formData: FormData
): Promise<AdminUserActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await adminUserError('UNAUTHORIZED') };

  const parsed = adminUserSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: await adminUserError(parsed.error.issues[0]?.message ?? 'INVALID') };
  }

  const hashedPassword = await hashPassword(parsed.data.password);

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: parsed.data.name, email: parsed.data.email, password: hashedPassword, role: 'ADMIN' },
        select: { id: true },
      });
      await appendAuditEvent({ actorUserId: session.userId, action: 'ADMIN.CREATED', targetType: 'User', targetId: created.id }, tx);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: await adminUserError('EMAIL_TAKEN') };
    }
    console.error('createAdminUser failed:', error);
    return { error: await adminUserError('CREATE_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/users');
  return { success: true };
}

export async function deleteAdminUser(id: string): Promise<AdminUserActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await adminUserError('UNAUTHORIZED') };

  if (id === session.userId) {
    return { error: await adminUserError('DELETE_SELF') };
  }

  // Their appointments carry the booking history and hold a foreign key to the
  // user row, so the account has to stay. Say why — silently doing nothing left
  // the admin clicking Delete over and over.
  const appointmentCount = await prisma.appointment.count({
    where: { userId: id },
  });

  if (appointmentCount > 0) {
    return { error: await adminUserError('HAS_APPOINTMENTS', { count: appointmentCount }) };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id, role: 'ADMIN' } });
      await appendAuditEvent({ actorUserId: session.userId, action: 'ADMIN.DELETED', targetType: 'User', targetId: id }, tx);
    });
  } catch (error) {
    console.error('deleteAdminUser failed:', error);
    return { error: await adminUserError('DELETE_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/admin/users');
  return { success: true };
}

export async function promoteGoogleUserToAdmin(id: string) {
  const { error, session } = await requireAdmin();
  if (error || !session) return;

  const user = await prisma.user.findFirst({
    where: {
      id,
      role: 'USER',
      oauthAccounts: { some: { provider: 'google' } },
    },
    select: { id: true },
  });

  if (!user) return;

  await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id: user.id, role: 'USER', oauthAccounts: { some: { provider: 'google' } } },
      data: { role: 'ADMIN', sessionVersion: { increment: 1 } },
    });
    if (changed.count !== 1) return;
    await appendAuditEvent({ actorUserId: session.userId, action: 'ADMIN.PROMOTED', targetType: 'User', targetId: user.id }, tx);
  });

  revalidateAllLocales(revalidatePath, '/admin/users');
}

// Requests need explicit approval. Every transition checks the current row in
// the same transaction as its conditional write, so cancellation cannot race
// an approval and revive a slot that has already been released.
const ALLOWED_APPOINTMENT_STATUSES = ['CONFIRMED', 'COMPLETED', 'CANCELLED'] as const;
type AppointmentStatus = (typeof ALLOWED_APPOINTMENT_STATUSES)[number];

const statusInclude = {
  user: { select: { email: true, name: true } },
  stylist: { select: { name: true, treatwellExternalId: true } },
  service: { select: { name: true, price: true, duration: true, treatwellExternalId: true, isConsultation: true, isPatchTest: true } },
} as const;
type StatusAppointment = Prisma.AppointmentGetPayload<{ include: typeof statusInclude }>;

/**
 * `refresh`: the board changed although the action was refused (a deposit's
 * state moved, or the request was cancelled), so the caller reloads it.
 */
export type AppointmentStatusResult = { success: true } | { success: false; error: string; refresh?: true };

/** A cancelled booking leaves Treatwell too, when it was sent there. */
function cancelledSyncFields(current: Pick<StatusAppointment, 'treatwellBookingId' | 'stylist' | 'service'>) {
  const api = getTreatwellApiConfiguration();
  return {
    treatwellSyncStatus: changedTreatwellSyncStatus({
      apiReady: api.enabled && api.configured,
      treatwellBookingId: current.treatwellBookingId,
      stylistExternalId: current.stylist.treatwellExternalId,
      serviceExternalId: current.service.treatwellExternalId,
    }),
    treatwellSyncError: null,
  };
}

/**
 * Staff move a booking on the board: confirm a request, mark a visit
 * completed, or cancel (decline) it. Card deposits
 * (docs/superpowers/specs/2026-10-13-square-deposits-design.md) follow:
 * confirming takes the request's deposit (approveWithDeposit); declining or
 * cancelling a request releases its hold; cancelling a confirmed booking
 * refunds a deposit taken in full unless `refundDeposit` is false (staff keep
 * it — a late cancellation or no-show, as the booking terms allow); marking
 * completed keeps a taken deposit (it counts toward the bill) and releases a
 * hold nobody took. Bookings without a deposit change exactly as before.
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  status: string,
  options: { refundDeposit?: boolean } = {},
): Promise<AppointmentStatusResult> {
  // Messages go back in the admin's interface language; see booking-errors.ts.
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    return { success: false, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  }
  if (!ALLOWED_APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    return { success: false, error: translator(locale, 'adminSchedule')('errors.INVALID_STATUS') };
  }
  // Keeping a taken deposit is an explicit choice; anything else refunds it.
  const refundDeposit = options?.refundDeposit !== false;
  let depositStep: ApprovalStep = 'NONE';
  let slotLost: { amountPence: number } | null = null;
  try {
    const now = new Date();
    if (status === 'CONFIRMED') {
      const target = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { stylistId: true } });
      // A request whose card hold has gone, or whose deposit someone else is
      // taking, is refused before the feed refresh; so is one whose deposit
      // this deployment cannot take.
      const deposit = target ? await loadLinkedDeposit(prisma, appointmentId) : null;
      const step = approvalStep(deposit, now);
      if (step !== 'NONE' && step !== 'CAPTURE' && step !== 'CONFIRM') throw new BookingError(step);
      if (step === 'CAPTURE' && deposit && !depositGatewayFor(deposit)) throw new BookingError('DEPOSIT_PAYMENTS_UNAVAILABLE');
      depositStep = step;
      // Network I/O stays outside the serializable transaction below. Re-import
      // this stylist's recent Fresha sales, and any stylist's feed the paused
      // out-of-hours import has let go stale, or an evening confirmation fails
      // the all-stylist calendar-freshness check until the next morning.
      if (target) await refreshCalendarFeedsBeforeApproval(target.stylistId);
    } else {
      // A capture nobody saw finish is settled first (Square is asked), so the
      // closing knows whether the deposit was taken or is still only held.
      const refusal = await settleDepositBeforeClosing(prisma, appointmentId, now);
      if (refusal) throw new BookingError(refusal);
    }

    if (depositStep !== 'NONE') {
      const approved = await approveWithDeposit(appointmentId, session.userId);
      // Finish the action's cache invalidation before external email delivery.
      invalidateStylistIcalFeed();
      if (approved.kind === 'SLOT_LOST') {
        // The request is cancelled; its refund row is committed. Ask Square now.
        await submitDepositRefund(prisma, approved.refundId);
        slotLost = { amountPence: approved.amountPence };
      }
      if (approved.notified) after(() => dispatchAppointmentNotifications(appointmentId));
    } else {
      const { appointment, notified, deposit } = await runSerializableWithRetry(async (tx) => {
        const current = await tx.appointment.findUnique({ where: { id: appointmentId }, include: statusInclude });
        if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
        if (current.status === status) return { appointment: current, notified: false, deposit: NO_DEPOSIT };
        if (status === 'CONFIRMED' && current.status !== 'PENDING') {
          throw new BookingError('ONLY_PENDING_CONFIRM');
        }
        if (current.status === 'CANCELLED') {
          throw new BookingError('CANCELLED_CANNOT_REINSTATE');
        }
        const now = new Date();
        const started = hasAppointmentStarted(current.date, now);
        // Nobody can be told "confirmed" for a time that has already come; the
        // notifications cron closes such a request instead (pending-request-lapse.ts).
        if (status === 'CONFIRMED' && started) throw new BookingError('REQUEST_EXPIRED');
        // Completion cannot be undone, so it waits until the visit has begun.
        if (status === 'COMPLETED' && !started) throw new BookingError('COMPLETE_BEFORE_START');

        if (status === 'CONFIRMED') {
          const readiness = await checkCalendarBookingReadiness(tx);
          if (!readiness.ready) throw new BookingError('CALENDAR_SETUP_NEEDED');
          // Imported bookings or opening hours may have changed since the request.
          // Staff decide; the diary chair rule only refuses customers (spec §6).
          await assertAppointmentSlotAvailable(tx, current, current.date, undefined, { chairRule: false });
        }

        // The deposit, if any: refused while it is being taken; otherwise what
        // the customer is told and what happens once this commits.
        const deposit = status === 'CONFIRMED' ? NO_DEPOSIT : await planDepositForClosing(tx, appointmentId, {
          closing: status === 'CANCELLED' ? 'CANCEL' : 'COMPLETE',
          // A request never became a booking: its deposit always goes back.
          refund: current.status === 'PENDING' || refundDeposit,
          reason: 'STAFF_CANCELLED',
          requestedById: session.userId,
          now,
        });

        const data: Prisma.AppointmentUpdateManyMutationInput = {
          status,
          // A cancelled or completed booking has nothing left to move.
          ...(status !== 'CONFIRMED' ? { rescheduleRequestedDate: null, rescheduleRequestedAt: null } : {}),
          notificationVersion: { increment: 1 },
          ...(status === 'CANCELLED' ? cancelledSyncFields(current) : {}),
          // Marking a visit completed means the customer came.
          ...(status === 'COMPLETED' && !current.arrivedAt ? { arrivedAt: now } : {}),
        };

        const result = await tx.appointment.updateMany({
          where: { id: appointmentId, status: current.status, date: current.date, updatedAt: current.updatedAt },
          data,
        });
        if (result.count !== 1) throw new BookingError('STALE');
        const updated = await tx.appointment.findUnique({ where: { id: appointmentId }, include: statusInclude });
        if (!updated) throw new BookingError('APPOINTMENT_NOT_FOUND');
        const depositNotice = { ...updated, paymentAttempt: deposit.paymentAttempt };
        const depositOutcome = deposit.outcome ? { depositOutcome: deposit.outcome } : {};
        // A cancellation is news only while the visit is still ahead. Tidying the
        // diary afterwards (a no-show, a duplicate) must not tell the customer
        // their appointment "has been cancelled"; the version bump above still
        // retires anything queued earlier for this booking.
        let notified = false;
        if (status === 'CONFIRMED') {
          await enqueueAppointmentNotification(tx, 'CONFIRMATION', updated);
          notified = true;
        } else if (status === 'CANCELLED' && !started) {
          // A declined request was never in the customer's calendar: no file to remove it.
          await enqueueAppointmentNotification(tx, 'CANCELLATION', depositNotice, { wasConfirmed: current.status === 'CONFIRMED', ...depositOutcome });
          notified = true;
        } else if (status === 'CANCELLED' && current.status === 'PENDING' && await isRequestLapseNoticeDue(tx, current, now)) {
          // Declining a request whose time has come closes it exactly as the
          // lapse step would, which then skips it (no longer PENDING): the
          // customer gets the same "couldn't confirm in time" email. The phone
          // read is best effort (on PostgreSQL a failed statement aborts the
          // transaction, so the decline then fails whole and is simply retried).
          await enqueueAppointmentNotification(tx, 'REQUEST_LAPSED', depositNotice, { salonPhone: await readSalonPhoneForLapseNotice(tx), ...depositOutcome });
          notified = true;
        }
        await appendAuditEvent({
          actorUserId: session.userId, action: 'APPOINTMENT.STATUS', targetType: 'Appointment', targetId: appointmentId,
          // Staff keeping a deposit is recorded as KEPT.
          metadata: { from: current.status, to: status, ...(deposit.outcome ? { deposit: deposit.outcome, depositPence: deposit.amountPence } : {}) },
        }, tx);
        return { appointment: updated, notified, deposit };
      });

      // Finish the action's cache invalidation before external email delivery.
      invalidateStylistIcalFeed();
      // Release the hold or ask Square for the refund, now that it is committed.
      await settleDepositAfterCommit(prisma, deposit);
      if (notified) after(() => dispatchAppointmentNotifications(appointment.id));
    }
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Changing an appointment status failed:', { appointmentId, status, ...describeFault(error) });
    const failure = { success: false as const, error: describeBookingError(error, locale, 'ADMIN_UPDATE_FAILED') };
    // A refused deposit approval may still have moved the deposit's state.
    return depositStep === 'NONE' ? failure : { ...failure, refresh: true };
  }
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/book');
  if (slotLost) {
    return { success: false, refresh: true, error: bookingErrorText(locale, 'DEPOSIT_SLOT_LOST_REFUNDED', { amount: formatGBP(slotLost.amountPence, HTML_LANG[locale]) }) };
  }
  return { success: true };
}

type DepositApproval =
  | { kind: 'CONFIRMED'; notified: boolean }
  | { kind: 'SLOT_LOST'; notified: boolean; refundId: string; amountPence: number };

/**
 * Confirm a request that holds a card deposit ("Approve (staff) — capture" in
 * the deposits design). Transaction 1 makes every check a plain approval
 * makes and claims the deposit — only one approval ever can. Square then takes
 * it, outside any transaction. Transaction 2 re-checks the time and confirms
 * (CONFIRMED + CAPTURED + the confirmation email, together) — or, had the time
 * been taken meanwhile, cancels the request with a full refund (SLOT_LOST).
 * A deposit taken earlier, by an approval that could not save its
 * confirmation, is confirmed in transaction 1 without touching money. If
 * transaction 2 fails, the deposit is recorded taken so that confirming again
 * cannot take it twice.
 */
async function approveWithDeposit(appointmentId: string, actorUserId: string): Promise<DepositApproval> {
  const claimed = await runSerializableWithRetry(async (tx) => {
    const now = new Date();
    const current = await tx.appointment.findUnique({ where: { id: appointmentId }, include: statusInclude });
    if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
    if (current.status === 'CONFIRMED') return { kind: 'DONE' as const, notified: false };
    if (current.status !== 'PENDING') throw new BookingError('ONLY_PENDING_CONFIRM');
    if (hasAppointmentStarted(current.date, now)) throw new BookingError('REQUEST_EXPIRED');
    const readiness = await checkCalendarBookingReadiness(tx);
    if (!readiness.ready) throw new BookingError('CALENDAR_SETUP_NEEDED');
    // Staff decide; the diary chair rule only refuses customers (spec §6).
    await assertAppointmentSlotAvailable(tx, current, current.date, undefined, { chairRule: false });
    const claim = await claimDepositForCapture(tx, appointmentId, now);
    // The deposit was read just before this transaction; it cannot vanish.
    if (claim.kind === 'NONE') throw new BookingError('STALE');
    if (claim.kind === 'CONFIRM') {
      await confirmDepositRequest(tx, current, claim.attempt, actorUserId, now);
      return { kind: 'DONE' as const, notified: true };
    }
    return { kind: 'CLAIMED' as const, attempt: claim.attempt, origin: claim.origin };
  });
  if (claimed.kind === 'DONE') return { kind: 'CONFIRMED', notified: claimed.notified };

  const taken = await takeDeposit(prisma, claimed.attempt, claimed.origin);
  if (taken !== 'CAPTURED') throw new BookingError(taken);

  try {
    return await runSerializableWithRetry(async (tx): Promise<DepositApproval> => {
      const now = new Date();
      const current = await tx.appointment.findUnique({ where: { id: appointmentId }, include: statusInclude });
      const attempt = await loadLinkedDeposit(tx, appointmentId);
      if (!current || !attempt || attempt.id !== claimed.attempt.id || (attempt.status !== 'CAPTURING' && attempt.status !== 'CAPTURED')) {
        throw new Error('The deposit approval lost its request');
      }
      // Confirmed meanwhile by an approval that took over a stale claim.
      if (current.status === 'CONFIRMED') {
        await markDepositCaptured(tx, attempt, now);
        return { kind: 'CONFIRMED', notified: false };
      }
      // Every closing refuses while a deposit is being taken, so a request
      // closed meanwhile means someone settled this capture already (and
      // refunded it with the closing): leave the money alone.
      if (current.status !== 'PENDING') throw new Error('The request closed while its deposit was being taken');
      try {
        // Staff decide; the diary chair rule only refuses customers (spec §6).
        await assertAppointmentSlotAvailable(tx, current, current.date, undefined, { chairRule: false });
      } catch (error) {
        if (!(error instanceof BookingError)) throw error;
        return cancelAfterSlotLost(tx, current, attempt, actorUserId, now);
      }
      await confirmDepositRequest(tx, current, attempt, actorUserId, now);
      return { kind: 'CONFIRMED', notified: true };
    });
  } catch (error) {
    await recordDepositTakenNotConfirmed(prisma, claimed.attempt.id, new Date());
    if (!(error instanceof BookingError)) console.error('Confirming a request after taking its deposit failed:', { appointmentId, ...describeFault(error) });
    throw new BookingError('DEPOSIT_TAKEN_NOT_CONFIRMED');
  }
}

/** PENDING → CONFIRMED with its deposit recorded taken and the confirmation email saying so. */
async function confirmDepositRequest(tx: Prisma.TransactionClient, current: StatusAppointment, attempt: LinkedDeposit, actorUserId: string, now: Date) {
  const result = await tx.appointment.updateMany({
    where: { id: current.id, status: 'PENDING', date: current.date, updatedAt: current.updatedAt },
    data: { status: 'CONFIRMED', notificationVersion: { increment: 1 } },
  });
  if (result.count !== 1) throw new BookingError('STALE');
  await markDepositCaptured(tx, attempt, now);
  const updated = await tx.appointment.findUnique({ where: { id: current.id }, include: statusInclude });
  if (!updated) throw new BookingError('APPOINTMENT_NOT_FOUND');
  await enqueueAppointmentNotification(tx, 'CONFIRMATION', { ...updated, paymentAttempt: { status: 'CAPTURED', amountPence: attempt.amountPence } });
  await appendAuditEvent({
    actorUserId, action: 'APPOINTMENT.STATUS', targetType: 'Appointment', targetId: current.id,
    metadata: { from: 'PENDING', to: 'CONFIRMED', deposit: 'CAPTURED', depositPence: attempt.amountPence },
  }, tx);
}

/**
 * The time was taken between taking the deposit and confirming (rare): the
 * request is cancelled and its deposit refunded in full, in this transaction
 * (the refund row; Square is asked after the commit). The customer is told
 * the deposit is on its way back; the admin is told why (the action's error).
 */
async function cancelAfterSlotLost(
  tx: Prisma.TransactionClient, current: StatusAppointment, attempt: LinkedDeposit, actorUserId: string, now: Date,
): Promise<DepositApproval> {
  const closed = await tx.appointment.updateMany({
    where: { id: current.id, status: 'PENDING', date: current.date, updatedAt: current.updatedAt },
    data: { status: 'CANCELLED', rescheduleRequestedDate: null, rescheduleRequestedAt: null, notificationVersion: { increment: 1 }, ...cancelledSyncFields(current) },
  });
  if (closed.count !== 1) throw new BookingError('STALE');
  await markDepositCaptured(tx, attempt, now);
  const deposit = await planDepositForClosing(tx, current.id, { closing: 'CANCEL', refund: true, reason: 'SLOT_LOST', requestedById: null, now });
  if (!deposit.refundId) throw new Error('The deposit taken for a lost time could not be refunded');
  const updated = await tx.appointment.findUnique({ where: { id: current.id }, include: statusInclude });
  if (!updated) throw new BookingError('APPOINTMENT_NOT_FOUND');
  // A request never confirmed: no calendar file to remove.
  const notified = !hasAppointmentStarted(current.date, now);
  if (notified) {
    await enqueueAppointmentNotification(tx, 'CANCELLATION', { ...updated, paymentAttempt: deposit.paymentAttempt }, { wasConfirmed: false, depositOutcome: 'REFUNDING' });
  }
  await appendAuditEvent({
    actorUserId, action: 'APPOINTMENT.STATUS', targetType: 'Appointment', targetId: current.id,
    metadata: { from: 'PENDING', to: 'CANCELLED', reason: 'SLOT_LOST', deposit: 'REFUNDING', depositPence: deposit.amountPence },
  }, tx);
  return { kind: 'SLOT_LOST', notified, refundId: deposit.refundId, amountPence: deposit.amountPence };
}

/**
 * Staff answer a customer's reschedule request (booking.ts requestReschedule).
 * APPROVE runs the same pre-approval Fresha refresh as a new booking's
 * approval, then re-checks the requested time exactly as that approval does
 * before moving the booking. DECLINE leaves the booking untouched. Not gated by
 * the online-booking lock.
 */
export async function decideRescheduleRequest(appointmentId: string, decision: 'APPROVE' | 'DECLINE', requestedAt: string) {
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { success: false as const, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  if (decision !== 'APPROVE' && decision !== 'DECLINE') {
    return { success: false as const, error: translator(locale, 'adminSchedule')('errors.INVALID_STATUS') };
  }
  const expected = new Date(requestedAt);
  if (Number.isNaN(expected.getTime())) return { success: false as const, error: bookingErrorText(locale, 'RESCHEDULE_REQUEST_CHANGED') };
  const include = {
    user: { select: { email: true, name: true, phone: true } },
    stylist: { select: { name: true, treatwellExternalId: true } },
    service: { select: { id: true, name: true, price: true, duration: true, treatwellExternalId: true, requiresPatchTest: true, isConsultation: true, isPatchTest: true } },
  } as const;
  try {
    if (decision === 'APPROVE') {
      // Network I/O stays outside the serializable transaction below (same
      // refresh as a new booking's approval; see refreshCalendarFeedsBeforeApproval).
      const target = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { stylistId: true } });
      if (target) await refreshCalendarFeedsBeforeApproval(target.stylistId);
    }
    const moved = await runSerializableWithRetry(async (tx) => {
      const current = await tx.appointment.findUnique({ where: { id: appointmentId }, include });
      if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
      const requested = current.rescheduleRequestedDate;
      if (current.status !== 'CONFIRMED' || !requested || current.rescheduleRequestedAt?.getTime() !== expected.getTime()) {
        throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
      }
      const guard = { id: appointmentId, status: 'CONFIRMED', date: current.date, rescheduleRequestedAt: current.rescheduleRequestedAt };
      const audit = (action: string, extra: Record<string, unknown> = {}) => appendAuditEvent({
        actorUserId: session.userId, action, targetType: 'Appointment', targetId: appointmentId,
        metadata: { from: current.date.toISOString(), to: requested.toISOString(), requestedAt: expected.toISOString(), ...extra },
      }, tx);

      if (decision === 'DECLINE') {
        const cleared = await tx.appointment.updateMany({ where: guard, data: { rescheduleRequestedDate: null, rescheduleRequestedAt: null } });
        if (cleared.count !== 1) throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
        // The email tells the customer how to call the salon for another time.
        const settings = await tx.siteSettings.findUnique({ where: { id: 'singleton' }, select: { phone: true } });
        await enqueueAppointmentNotification(tx, 'RESCHEDULE_DECLINED', current, { requestedDate: requested, requestedAt: expected, salonPhone: settings?.phone || undefined });
        await audit('APPOINTMENT.RESCHEDULE_DECLINED');
        return false;
      }

      // Too close to the requested time, or the original visit has already
      // happened (moving it would email a "moved" notice for a past booking).
      if (isRescheduleRequestMoot({ date: current.date, rescheduleRequestedDate: requested })) throw new BookingError('RESCHEDULE_REQUEST_EXPIRED');
      const readiness = await checkCalendarBookingReadiness(tx);
      if (!readiness.ready) throw new BookingError('CALENDAR_SETUP_NEEDED');
      if (current.service.requiresPatchTest) {
        const eligibility = await getValidPatchTest(current.userId, requested);
        if (!eligibility.ok) {
          throw new BookingError(eligibility.reason === 'too_soon' ? 'PATCH_TEST_TOO_SOON'
            : eligibility.reason === 'expired' ? 'PATCH_TEST_EXPIRED' : 'PATCH_TEST_REQUIRED');
        }
      }
      try {
        // Staff decide; the diary chair rule only refuses customers (spec §6).
        await assertAppointmentSlotAvailable(tx, current, requested, undefined, { chairRule: false });
      } catch (error) {
        if (error instanceof BookingError && error.code === 'SLOT_UNAVAILABLE') throw new BookingError('RESCHEDULE_SLOT_TAKEN');
        throw error;
      }
      const api = getTreatwellApiConfiguration();
      const treatwellSyncStatus = changedTreatwellSyncStatus({
        apiReady: api.enabled && api.configured,
        treatwellBookingId: current.treatwellBookingId,
        stylistExternalId: current.stylist.treatwellExternalId,
        serviceExternalId: current.service.treatwellExternalId,
      });
      // Asked for less than DEPOSIT_REFUND_NOTICE_HOURS before the booking's
      // start, when cancelling would already have kept the deposit: it stays
      // kept at the new time (owner decision 2026-10-18), so a move cannot
      // turn a kept deposit back into a refund. Once locked, it stays locked.
      const depositLockedAt = current.depositLockedAt
        ?? (isDepositRefundableOnCancel(current.date, expected) ? null : expected);
      const changed = await tx.appointment.updateMany({
        where: guard,
        data: {
          date: requested, rescheduleRequestedDate: null, rescheduleRequestedAt: null, reminderSent: false,
          treatwellSyncStatus, treatwellSyncError: null, notificationVersion: { increment: 1 }, depositLockedAt,
        },
      });
      if (changed.count !== 1) throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
      const updated = await tx.appointment.findUnique({ where: { id: appointmentId }, include });
      if (!updated) throw new BookingError('APPOINTMENT_NOT_FOUND');
      // The email says so only when there is a taken deposit to keep.
      const attempt = depositLockedAt ? await tx.paymentAttempt.findUnique({ where: { appointmentId }, select: { status: true } }) : null;
      await enqueueAppointmentNotification(tx, 'RESCHEDULE', updated, { oldDate: current.date, ...(attempt?.status === 'CAPTURED' ? { depositLocked: true } : {}) });
      await audit('APPOINTMENT.RESCHEDULE_APPROVED', depositLockedAt ? { depositLockedAt: depositLockedAt.toISOString() } : {});
      return true;
    });
    // Finish the action's cache invalidation before external email delivery.
    // A decline moves nothing (the busy feed stays) but re-renders the Google Calendar event.
    if (moved) invalidateStylistIcalFeed();
    else scheduleGoogleCalendarPush([appointmentId]);
    after(() => dispatchAppointmentNotifications(appointmentId));
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Reschedule decision failed:', error);
    return { success: false as const, error: describeBookingError(error, locale, 'ADMIN_UPDATE_FAILED') };
  }
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/book');
  return { success: true as const };
}

export async function resetUserPassword(userId: string, newPassword: string) {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await adminUserError('UNAUTHORIZED') };

  if (!newPassword || newPassword.length < 8) {
    return { error: await adminUserError('PASSWORD_TOO_SHORT') };
  }

  if (!fitsBcryptLimit(newPassword)) {
    return { error: await adminUserError('PASSWORD_TOO_LONG') };
  }

  // Verify the target user is an admin (admins can only reset other admin passwords)
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!targetUser || targetUser.role !== 'ADMIN') {
    return { error: await adminUserError('RESET_ONLY_ADMINS') };
  }

  const hashedPassword = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId, role: 'ADMIN' },
      // Keep the existing MFA factor. Password recovery cannot bypass it.
      data: { password: hashedPassword, sessionVersion: { increment: 1 } },
    });
    // An emailed reset link issued before this change must not outlive it: it
    // would let whoever holds it overwrite the password just set (e.g. while
    // recovering a compromised account). Same transaction, so a failed reset
    // leaves the links alone and a racing redemption finds nothing to claim.
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    await appendAuditEvent({ actorUserId: session.userId, action: 'ADMIN.PASSWORD_RESET', targetType: 'User', targetId: userId }, tx);
  });

  revalidateAllLocales(revalidatePath, '/admin/users');
  return { success: true };
}
