'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { invalidateStylistIcalFeed } from '@/app/services/stylist-ical-cache';
import type { Prisma } from '@prisma/client';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { runSerializableWithRetry } from '@/app/services/booking-service';
import { describeAdminMoveClashes, type MoveClash } from '@/app/services/admin-move-clashes';
import {
  enqueueAppointmentNotification,
  dispatchAppointmentNotifications,
} from '@/app/services/notification-outbox-service';
import {
  changedTreatwellSyncStatus,
  getTreatwellApiConfiguration,
  initialTreatwellSyncStatus,
} from '@/app/services/treatwell-api';
import { quoteForNewBooking } from '@/app/services/pricing/quote-service';
import { quoteMatches, serializeQuote, type PriceQuote } from '@/app/services/pricing/quote';
import { penceToDecimalString } from '@/app/services/pricing/money';
import { getActionLocale } from '@/i18n/request';
import { isLocale, type Locale } from '@/i18n/config';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { isPlaceholderEmail, placeholderEmailFor } from '@/app/lib/walk-in-customer';
import { resolveSalonDateTime, SALON_DATE_RE, SALON_TIME_RE } from '@/app/services/salon-time';
import { MIN_DURATION_MINUTES } from '@/app/lib/calendar-geometry';
import { BookingError, bookingErrorText, describeBookingError, type BookingErrorCode } from '@/app/services/booking-errors';

/** Every admin write on this board answers to the same gate. */
async function requireAdmin(locale: Locale): Promise<string | null> {
  const session = await verifySession();
  return session.role === 'ADMIN' ? null : bookingErrorText(locale, 'NOT_AUTHORISED');
}

/**
 * Zod issues on this board carry a message CODE (e.g. 'CHOOSE_SERVICE'), so the
 * text is chosen in the admin's language here — never matched from English.
 */
function issueText(locale: Locale, issue: { message: string } | undefined): string {
  const code = issue?.message;
  return code && /^[A-Z_]+$/.test(code) ? bookingErrorText(locale, code as BookingErrorCode) : bookingErrorText(locale, 'INVALID_REQUEST');
}

/** The part of a new quote the board shows before an admin confirms a service change. */
export type AdminQuote = Pick<PriceQuote, 'serviceId' | 'priceVersion' | 'amountPence' | 'priceType' | 'vatDisplay' | 'priceNature'>;

class AdminPriceChanged extends BookingError {
  constructor(readonly quote: PriceQuote) {
    super('PRICE_CHANGED');
  }
}

const expectedQuoteSchema = z.object({
  serviceId: z.string().min(1),
  priceVersion: z.number().int().min(0),
  amountPence: z.number().int().min(0),
});

const moveSchema = z.object({
  appointmentId: z.string().min(1),
  dateStr: z.string().regex(SALON_DATE_RE, 'INVALID_DATE_TIME'),
  time: z.string().regex(SALON_TIME_RE, 'INVALID_DATE_TIME'),
  durationMin: z.number().int().min(MIN_DURATION_MINUTES).max(12 * 60),
  stylistId: z.string().min(1),
  overrideClashes: z.boolean(),
  expectedUpdatedAt: z.string().min(1),
});

/**
 * An edit is a move plus the fields a drag cannot express. Everything optional
 * here is left untouched when omitted, so the drag path keeps its exact shape.
 */
const editSchema = moveSchema.extend({
  serviceId: z.string().min(1).optional(),
  notes: z.string().max(1000).optional(),
  /**
   * The new service's price as the dialog showed it. A service change is only
   * written against the price the admin saw; if it moved, the board gets the
   * new quote back to confirm instead.
   */
  expectedQuote: expectedQuoteSchema.optional(),
});

export type MoveAppointmentInput = z.infer<typeof moveSchema>;
export type EditAppointmentInput = z.infer<typeof editSchema>;

export type MoveAppointmentResult =
  | { success: true }
  | { success: false; error: string; quote?: AdminQuote }
  | { success: false; clashes: MoveClash[] };

function toAdminQuote(quote: PriceQuote): AdminQuote {
  const { serviceId, priceVersion, amountPence, priceType, vatDisplay, priceNature } = quote;
  return { serviceId, priceVersion, amountPence, priceType, vatDisplay, priceNature };
}

/**
 * Move, resize, restyle or re-service an appointment from the admin board.
 *
 * Differs from the customer reschedule path (actions/booking.ts) in four ways,
 * all deliberate:
 *
 *  - It can change the DURATION, the STYLIST, the DAY and the SERVICE, not just
 *    the start time.
 *  - Clashes warn instead of refusing. `overrideClashes` lets the salon
 *    deliberately double-book — a blow-dry during colour processing time is
 *    normal practice — but only after being told exactly what it collides with.
 *  - The 24-hour policy does NOT apply. That rule exists to stop *customers*
 *    rearranging same-day work; applying it here would block the exact case this
 *    feature is for, an appointment over-running today.
 *  - `assertOnlineBookingReady` is NOT called. That gate closes *online* booking
 *    when an external calendar feed goes stale; an admin standing in the salon
 *    must still be able to fix today's board.
 */
export async function editAppointmentByAdmin(input: EditAppointmentInput): Promise<MoveAppointmentResult> {
  const locale = await getActionLocale();
  const unauthorised = await requireAdmin(locale);
  if (unauthorised) return { success: false, error: unauthorised };

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: issueText(locale, parsed.error.issues[0]) };
  }
  const { appointmentId, dateStr, time, durationMin, stylistId, overrideClashes, expectedUpdatedAt, serviceId, notes, expectedQuote } = parsed.data;

  const salon = resolveSalonDateTime(dateStr, time);
  const newDate = salon.utc;
  if (Number.isNaN(newDate.getTime())) {
    return { success: false, error: bookingErrorText(locale, 'INVALID_DATE_TIME') };
  }

  try {
    const outcome = await runSerializableWithRetry(async (tx) => {
      const current = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          user: { select: { email: true, name: true, phone: true } },
          stylist: { select: { name: true, treatwellExternalId: true } },
          service: { select: { id: true, name: true, price: true, duration: true, requiresPatchTest: true, treatwellExternalId: true } },
        },
      });
      if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
      if (current.status === 'CANCELLED') {
        throw new BookingError('CANCELLED_CANNOT_MOVE');
      }

      // A swapped service brings its own patch-test rule and its own price, so
      // resolve it before the clash scan rather than after. Changing to another
      // service/option is a NEW price: quoted by the same rules as any new
      // booking (bookable options only, no discounts), and written only if it
      // is the price the admin was shown. Moving, resizing or restyling alone
      // never touches the recorded price.
      const serviceChanged = Boolean(serviceId) && serviceId !== current.serviceId;
      let newQuote: PriceQuote | null = null;
      let service: { id: string; requiresPatchTest: boolean; treatwellExternalId: string | null } = current.service;
      if (serviceChanged) {
        const quoted = await quoteForNewBooking(tx, serviceId!, 'ADMIN');
        if (!quoteMatches(quoted.quote, expectedQuote)) throw new AdminPriceChanged(quoted.quote);
        newQuote = quoted.quote;
        service = quoted.service;
      }

      // Always inside the transaction, on both paths: `overrideClashes` decides
      // whether a clash ABORTS the write, never whether the write is checked
      // against the same snapshot it commits against.
      const clashes = await describeAdminMoveClashes(tx, {
        appointmentId,
        stylistId,
        start: newDate,
        durationMin,
        userId: current.userId,
        requiresPatchTest: service.requiresPatchTest,
      });
      if (clashes.length > 0 && !overrideClashes) {
        return { kind: 'clashes' as const, clashes };
      }

      const oldDate = current.date;
      const startMoved = oldDate.getTime() !== newDate.getTime();
      const stylistChanged = current.stylistId !== stylistId;

      const treatwellApi = getTreatwellApiConfiguration();
      const treatwellSyncStatus = changedTreatwellSyncStatus({
        apiReady: treatwellApi.enabled && treatwellApi.configured,
        treatwellBookingId: current.treatwellBookingId,
        stylistExternalId: current.stylist.treatwellExternalId,
        serviceExternalId: service.treatwellExternalId,
      });

      // Optimistic guard. The board reloads every 60 seconds, so two admins can
      // easily be dragging the same block; this turns that into an explicit
      // "refresh and try again" instead of a silent overwrite.
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, updatedAt: new Date(expectedUpdatedAt) },
        data: {
          date: newDate,
          durationAtBooking: durationMin,
          stylistId,
          ...(newQuote
            ? {
                serviceId: service.id,
                // Re-freeze the price against the new service, exactly as the
                // booking path does — otherwise the diary shows one service and
                // the payroll/reporting figures still charge for the old one.
                priceAtBooking: penceToDecimalString(newQuote.amountPence),
                quoteJson: serializeQuote(newQuote),
              }
            : {}),
          ...(notes === undefined ? {} : { notes: notes.trim() || null }),
          // A reminder already sent describes the OLD time.
          ...(startMoved ? { reminderSent: false } : {}),
          treatwellSyncStatus,
          treatwellSyncError: null,
          // A silent resize must not cancel an outstanding confirmation or
          // reminder; only a change to the customer's plans creates a version.
          ...((startMoved || stylistChanged || serviceChanged) ? { notificationVersion: { increment: 1 } } : {}),
        },
      });
      if (changed.count !== 1) throw new BookingError('STALE');

      // Only a changed arrival time, stylist or service is news to the customer.
      // A pure resize or a note edit leaves their plans untouched, so it stays
      // silent — as does a walk-in with no real address to mail.
      const notifiable = (startMoved || stylistChanged || serviceChanged)
        && ['CONFIRMED', 'PENDING'].includes(current.status)
        && !isPlaceholderEmail(current.user.email);
      if (notifiable) {
        const updated = await tx.appointment.findUnique({
          where: { id: appointmentId },
          include: {
            user: { select: { email: true, name: true, phone: true } },
            stylist: { select: { name: true } },
            service: { select: { name: true, price: true, duration: true } },
          },
        });
        if (!updated) throw new BookingError('APPOINTMENT_NOT_FOUND');
        if (current.status === 'PENDING') {
          // The old version's request notices are now stale. Persist fresh
          // receipt/alert snapshots so an edit cannot silently lose them.
          await enqueueAppointmentNotification(tx, 'REQUEST_RECEIVED', updated);
          await enqueueAppointmentNotification(tx, 'SALON_ALERT', updated);
        } else {
          await enqueueAppointmentNotification(tx, 'RESCHEDULE', updated, { oldDate });
        }
        return { kind: 'moved' as const, notify: true };
      }

      return { kind: 'moved' as const, notify: false };
    });

    if (outcome.kind === 'clashes') {
      return { success: false, clashes: outcome.clashes };
    }
    revalidateSchedule();
    if (outcome.notify) {
      after(() => dispatchAppointmentNotifications(appointmentId));
    }
    return { success: true };
  } catch (error) {
    if (error instanceof AdminPriceChanged) return { success: false, error: error.localized(locale), quote: toAdminQuote(error.quote) };
    if (!(error instanceof BookingError)) console.error('editAppointmentByAdmin failed', error);
    return { success: false, error: describeBookingError(error, locale, 'ADMIN_UPDATE_FAILED') };
  }
}

/** The drag path: position only. Thin wrapper so the grid cannot send more. */
export async function moveAppointmentByAdmin(input: MoveAppointmentInput): Promise<MoveAppointmentResult> {
  return editAppointmentByAdmin(input);
}

// --- Creating a booking the salon took off the website ---

const customerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), userId: z.string().min(1) }),
  z.object({
    kind: z.literal('new'),
    name: z.string().trim().min(1, 'CUSTOMER_NAME_REQUIRED').max(100),
    // Blank is normal and expected: most phone and WhatsApp bookings arrive
    // with a name and a number, nothing else.
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('EMAIL_INVALID').max(254)]),
    phone: z.string().trim().max(40),
  }),
]);

const createSchema = z.object({
  customer: customerSchema,
  serviceId: z.string().min(1, 'CHOOSE_SERVICE'),
  stylistId: z.string().min(1, 'CHOOSE_STYLIST'),
  dateStr: z.string().regex(SALON_DATE_RE, 'INVALID_DATE_TIME'),
  time: z.string().regex(SALON_TIME_RE, 'INVALID_DATE_TIME'),
  durationMin: z.number().int().min(MIN_DURATION_MINUTES).max(12 * 60),
  // The salon is entering a booking it has already agreed with the customer, so
  // CONFIRMED is the normal case. PENDING stays available for "pencil this in".
  status: z.enum(['CONFIRMED', 'PENDING']),
  notes: z.string().max(1000),
  notifyCustomer: z.boolean(),
  overrideClashes: z.boolean(),
  /** The price the dialog showed for the chosen service/option. */
  expectedQuote: expectedQuoteSchema.optional(),
  /**
   * Email language for a NEW customer (an existing customer's own preference,
   * or English, is used otherwise). Never the admin's interface language.
   */
  customerLocale: z.string().optional(),
});

export type CreateAppointmentInput = z.infer<typeof createSchema>;

export type CreateAppointmentResult =
  | { success: true; appointmentId: string }
  | { success: false; error: string; quote?: AdminQuote }
  | { success: false; clashes: MoveClash[] };

/**
 * Add a booking the salon took by phone, WhatsApp or at the desk.
 *
 * Shares the clash reporting and the transaction shape with the edit path above,
 * and deliberately skips three gates the *customer* booking flow applies:
 * the online-booking kill switch, the per-user booking cap, and the rate limit.
 * All three exist to police the public internet; none should stop a stylist
 * writing down the appointment standing in front of them.
 */
export async function createAppointmentByAdmin(input: CreateAppointmentInput): Promise<CreateAppointmentResult> {
  const locale = await getActionLocale();
  const unauthorised = await requireAdmin(locale);
  if (unauthorised) return { success: false, error: unauthorised };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: issueText(locale, parsed.error.issues[0]) };
  }
  const { customer, serviceId, stylistId, dateStr, time, durationMin, status, notes, notifyCustomer, overrideClashes, expectedQuote, customerLocale } = parsed.data;

  const salon = resolveSalonDateTime(dateStr, time);
  const date = salon.utc;
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: bookingErrorText(locale, 'INVALID_DATE_TIME') };
  }

  try {
    const outcome = await runSerializableWithRetry(async (tx) => {
      const [{ service, quote }, stylist] = await Promise.all([
        quoteForNewBooking(tx, serviceId, 'ADMIN'),
        tx.stylist.findUnique({ where: { id: stylistId }, select: { id: true, isActive: true, treatwellExternalId: true } }),
      ]);
      if (!quoteMatches(quote, expectedQuote)) throw new AdminPriceChanged(quote);
      if (!stylist) throw new BookingError('STYLIST_NOT_FOUND');
      if (!stylist.isActive) throw new BookingError('STYLIST_RETIRED_ADMIN');

      const user = await resolveCustomer(tx, customer, isLocale(customerLocale) ? customerLocale : null);

      const clashes = await describeAdminMoveClashes(tx, {
        // No row to exclude yet; '' never matches a cuid.
        appointmentId: '',
        stylistId,
        start: date,
        durationMin,
        userId: user.id,
        requiresPatchTest: service.requiresPatchTest,
      });
      if (clashes.length > 0 && !overrideClashes) {
        return { kind: 'clashes' as const, clashes };
      }

      const api = getTreatwellApiConfiguration();
      const created = await tx.appointment.create({
        data: {
          date,
          userId: user.id,
          stylistId,
          serviceId: service.id,
          status,
          priceAtBooking: penceToDecimalString(quote.amountPence),
          quoteJson: serializeQuote(quote),
          // The CUSTOMER's language for their mail, never the admin's screen.
          notificationLocale: user.preferredLocale ?? 'en-GB',
          durationAtBooking: durationMin,
          notes: notes.trim() || null,
          treatwellSyncStatus: initialTreatwellSyncStatus({
            apiEnabled: api.enabled && api.configured,
            stylistExternalId: stylist.treatwellExternalId,
            serviceExternalId: service.treatwellExternalId,
          }),
        },
        include: {
          user: { select: { email: true, name: true, phone: true } },
          stylist: { select: { name: true } },
          service: { select: { name: true, price: true, duration: true } },
        },
      });

      // A walk-in with a synthesised address must never reach the outbox: the
      // domain cannot resolve, so every attempt would burn 12 retries.
      const notify = notifyCustomer && status === 'CONFIRMED' && !isPlaceholderEmail(created.user.email);
      if (notify) await enqueueAppointmentNotification(tx, 'CONFIRMATION', created);

      return { kind: 'created' as const, appointmentId: created.id, notify };
    });

    if (outcome.kind === 'clashes') {
      return { success: false, clashes: outcome.clashes };
    }
    revalidateSchedule();
    if (outcome.notify) {
      after(() => dispatchAppointmentNotifications(outcome.appointmentId));
    }
    return { success: true, appointmentId: outcome.appointmentId };
  } catch (error) {
    if (error instanceof AdminPriceChanged) return { success: false, error: error.localized(locale), quote: toAdminQuote(error.quote) };
    if (!(error instanceof BookingError)) console.error('createAppointmentByAdmin failed', error);
    return { success: false, error: describeBookingError(error, locale, 'ADMIN_CREATE_FAILED') };
  }
}

/**
 * Find or make the customer row a salon-entered booking hangs off.
 *
 * An email the salon types is matched against existing customers first, so
 * repeat phone bookings accumulate on one account instead of failing the unique
 * constraint. Never touches an ADMIN row's details.
 */
async function resolveCustomer(
  tx: Prisma.TransactionClient,
  customer: z.infer<typeof customerSchema>,
  newCustomerLocale: Locale | null,
): Promise<{ id: string; email: string; preferredLocale: string | null }> {
  if (customer.kind === 'existing') {
    const existing = await tx.user.findUnique({ where: { id: customer.userId }, select: { id: true, email: true, preferredLocale: true } });
    if (!existing) throw new BookingError('CUSTOMER_GONE');
    return existing;
  }

  if (customer.email) {
    const existing = await tx.user.findUnique({ where: { email: customer.email }, select: { id: true, email: true, role: true, phone: true, preferredLocale: true } });
    if (existing) {
      // Fill a blank phone number in, but never overwrite what the customer
      // themselves set, and never edit an administrator's record.
      if (customer.phone && !existing.phone && existing.role !== 'ADMIN') {
        await tx.user.update({ where: { id: existing.id }, data: { phone: customer.phone } });
      }
      return { id: existing.id, email: existing.email, preferredLocale: existing.preferredLocale };
    }
  }

  return tx.user.create({
    // randomUUID, not the name: two customers called "Mary Smith" must not
    // collide on the unique email column.
    data: {
      email: customer.email || placeholderEmailFor(randomUUID()),
      name: customer.name,
      phone: customer.phone || null,
      preferredLocale: newCustomerLocale,
    },
    select: { id: true, email: true, preferredLocale: true },
  });
}

export type AdminCustomerMatch = { id: string; name: string | null; email: string; phone: string | null };

/**
 * Type-ahead over the salon's customers for the booking form.
 *
 * Filtered in memory on a bounded read rather than with `contains`, because the
 * three schema providers disagree about case sensitivity — Prisma's
 * `mode: 'insensitive'` is Postgres-only and throws on the SQLite dev schema.
 * At salon scale the cap below is never reached; the client debounces and
 * requires two characters, so this stays a handful of reads per booking.
 */
export async function searchAdminCustomers(query: string): Promise<AdminCustomerMatch[]> {
  const unauthorised = await requireAdmin(await getActionLocale());
  if (unauthorised) return [];

  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const candidates = await prisma.user.findMany({
    where: { role: 'USER' },
    select: { id: true, name: true, email: true, phone: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });

  return candidates
    .filter((row) =>
      [row.name, isPlaceholderEmail(row.email) ? null : row.email, row.phone]
        .some((field) => field?.toLowerCase().includes(needle)),
    )
    .slice(0, 8)
    .map(({ id, name, email, phone }) => ({ id, name, email, phone }));
}

function revalidateSchedule() {
  // Salon-entered and moved bookings occupy the chair exactly like online ones,
  // so the marketplaces' cached busy feed has to drop with them.
  invalidateStylistIcalFeed();
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/book');
}
