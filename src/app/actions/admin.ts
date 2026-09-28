'use server';

import { appendAuditEvent } from '@/app/lib/audit';
import { revalidateAllLocales } from '@/i18n/revalidate';
import prisma from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import { verifySession } from '@/app/lib/session';
import { revalidatePath, updateTag } from 'next/cache';
import { after } from 'next/server';
import { invalidateStylistIcalFeed } from '@/app/services/stylist-ical-cache';
import { hashPassword } from '@/app/lib/password';
import { z } from 'zod';
import { revalidateCategoryPages } from '@/app/actions/admin-services';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from '@/app/services/treatwell-api';
import { enqueueAppointmentNotification, dispatchAppointmentNotifications } from '@/app/services/notification-outbox-service';
import { checkCalendarBookingReadiness } from '@/app/services/integration-readiness';
import { refreshStaleCalendarFeeds } from '@/app/services/calendar-sync-service';
import { assertAppointmentSlotAvailable, runSerializableWithRetry } from '@/app/services/booking-service';
import { BookingError, bookingErrorText, describeBookingError } from '@/app/services/booking-errors';
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

// Messages are codes, translated by adminUserError() below.
const adminUserSchema = z.object({
  name: z.string('NAME_TOO_SHORT').min(2, 'NAME_TOO_SHORT').max(100, 'NAME_TOO_LONG'),
  email: z.string('EMAIL_INVALID').email('EMAIL_INVALID').max(254, 'EMAIL_TOO_LONG'),
  password: z.string('PASSWORD_TOO_SHORT').min(8, 'PASSWORD_TOO_SHORT').max(128, 'PASSWORD_TOO_LONG'),
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

export async function updateAppointmentStatus(appointmentId: string, status: string) {
  // Messages go back in the admin's interface language; see booking-errors.ts.
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    return { success: false, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  }
  if (!ALLOWED_APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    return { success: false, error: translator(locale, 'adminSchedule')('errors.INVALID_STATUS') };
  }
  try {
    // Network I/O stays outside the serializable transaction below. Outside
    // staff hours the scheduled import pauses, so without this an evening
    // confirmation fails the calendar-freshness check until the next morning.
    if (status === 'CONFIRMED') await refreshStaleCalendarFeeds();
    const { appointment, changed } = await runSerializableWithRetry(async (tx) => {
      const include = {
        user: { select: { email: true, name: true } },
        stylist: { select: { name: true, treatwellExternalId: true } },
        service: { select: { name: true, price: true, duration: true, treatwellExternalId: true } },
      } as const;
      const current = await tx.appointment.findUnique({ where: { id: appointmentId }, include });
      if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
      if (current.status === status) return { appointment: current, changed: false };
      if (status === 'CONFIRMED' && current.status !== 'PENDING') {
        throw new BookingError('ONLY_PENDING_CONFIRM');
      }
      if (current.status === 'CANCELLED') {
        throw new BookingError('CANCELLED_CANNOT_REINSTATE');
      }

      if (status === 'CONFIRMED') {
        const readiness = await checkCalendarBookingReadiness(tx);
        if (!readiness.ready) throw new BookingError('CALENDAR_SETUP_NEEDED');
        // Imported bookings or opening hours may have changed since the request.
        await assertAppointmentSlotAvailable(tx, current, current.date);
      }

      const data: Prisma.AppointmentUpdateManyMutationInput = {
        status,
        notificationVersion: { increment: 1 },
      };
      if (status === 'CANCELLED') {
        const api = getTreatwellApiConfiguration();
        data.treatwellSyncStatus = changedTreatwellSyncStatus({
          apiReady: api.enabled && api.configured,
          treatwellBookingId: current.treatwellBookingId,
          stylistExternalId: current.stylist.treatwellExternalId,
          serviceExternalId: current.service.treatwellExternalId,
        });
        data.treatwellSyncError = null;
      }

      const result = await tx.appointment.updateMany({
        where: { id: appointmentId, status: current.status, date: current.date, updatedAt: current.updatedAt },
        data,
      });
      if (result.count !== 1) throw new BookingError('STALE');
      const updated = await tx.appointment.findUnique({ where: { id: appointmentId }, include });
      if (!updated) throw new BookingError('APPOINTMENT_NOT_FOUND');
      if (status === 'CONFIRMED' || status === 'CANCELLED') await enqueueAppointmentNotification(tx, status === 'CONFIRMED' ? 'CONFIRMATION' : 'CANCELLATION', updated);
      await appendAuditEvent({ actorUserId: session.userId, action: 'APPOINTMENT.STATUS', targetType: 'Appointment', targetId: appointmentId, metadata: { from: current.status, to: status } }, tx);
      return { appointment: updated, changed: true };
    });

    // Finish the action's cache invalidation before external email delivery.
    invalidateStylistIcalFeed();
    if (changed) after(() => dispatchAppointmentNotifications(appointment.id));
  } catch (error) {
    return { success: false, error: describeBookingError(error, locale, 'ADMIN_UPDATE_FAILED') };
  }
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/book');
  return { success: true };
}

export async function resetUserPassword(userId: string, newPassword: string) {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await adminUserError('UNAUTHORIZED') };

  if (!newPassword || newPassword.length < 8) {
    return { error: await adminUserError('PASSWORD_TOO_SHORT') };
  }

  if (newPassword.length > 128) {
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
    await appendAuditEvent({ actorUserId: session.userId, action: 'ADMIN.PASSWORD_RESET', targetType: 'User', targetId: userId }, tx);
  });

  revalidateAllLocales(revalidatePath, '/admin/users');
  return { success: true };
}
