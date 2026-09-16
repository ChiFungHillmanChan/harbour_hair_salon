'use server';

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
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
import { getActiveGlobalOffer } from '@/app/services/offers-service';
import { applyOfferToPrice } from '@/app/services/offer-pricing';
import { isPlaceholderEmail, placeholderEmailFor } from '@/app/lib/walk-in-customer';
import { resolveSalonDateTime, SALON_DATE_RE, SALON_TIME_RE } from '@/app/services/salon-time';
import { MIN_DURATION_MINUTES } from '@/app/lib/calendar-geometry';
import { BookingError } from '@/app/services/booking-errors';

const STALE_MESSAGE = 'This appointment has changed. Please refresh and try again.';

/** Every admin write on this board answers to the same gate. */
async function requireAdmin(): Promise<string | null> {
  const session = await verifySession();
  return session.role === 'ADMIN' ? null : 'Not authorised';
}

const moveSchema = z.object({
  appointmentId: z.string().min(1),
  dateStr: z.string().regex(SALON_DATE_RE, 'Invalid date'),
  time: z.string().regex(SALON_TIME_RE, 'Invalid time'),
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
});

export type MoveAppointmentInput = z.infer<typeof moveSchema>;
export type EditAppointmentInput = z.infer<typeof editSchema>;

export type MoveAppointmentResult =
  | { success: true }
  | { success: false; error: string }
  | { success: false; clashes: MoveClash[] };

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
  const unauthorised = await requireAdmin();
  if (unauthorised) return { success: false, error: unauthorised };

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' };
  }
  const { appointmentId, dateStr, time, durationMin, stylistId, overrideClashes, expectedUpdatedAt, serviceId, notes } = parsed.data;

  const salon = resolveSalonDateTime(dateStr, time);
  const newDate = salon.utc;
  if (Number.isNaN(newDate.getTime())) {
    return { success: false, error: 'Invalid date or time' };
  }

  // Read outside the transaction: a rarely-changing announcement, not part of
  // the double-booking invariant. Only needed when the service actually changes.
  const globalOffer = serviceId ? await getActiveGlobalOffer() : null;

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
      if (!current) throw new BookingError('Appointment not found');
      if (current.status === 'CANCELLED') {
        throw new BookingError('A cancelled appointment cannot be moved — create a new booking.');
      }

      // A swapped service brings its own patch-test rule and its own price, so
      // resolve it before the clash scan rather than after.
      const serviceChanged = Boolean(serviceId) && serviceId !== current.serviceId;
      const service = serviceChanged
        ? await tx.service.findUnique({
            where: { id: serviceId },
            select: { id: true, name: true, price: true, duration: true, requiresPatchTest: true, treatwellExternalId: true },
          })
        : current.service;
      if (!service) throw new BookingError('Service not found');

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
          ...(serviceChanged
            ? {
                serviceId: service.id,
                // Re-freeze the price against the new service, exactly as the
                // booking path does — otherwise the diary shows one service and
                // the payroll/reporting figures still charge for the old one.
                priceAtBooking: applyOfferToPrice(Number(service.price), globalOffer),
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
      if (changed.count !== 1) throw new BookingError(STALE_MESSAGE);

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
        if (!updated) throw new BookingError('Appointment not found');
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
    if (outcome.notify) {
      await dispatchAppointmentNotifications(appointmentId);
    }

    revalidateSchedule();
    return { success: true };
  } catch (error) {
    if (error instanceof BookingError) return { success: false, error: error.message };
    console.error('editAppointmentByAdmin failed', error);
    return { success: false, error: 'Could not update this appointment. Please try again.' };
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
    name: z.string().trim().min(1, 'Customer name is required').max(100),
    // Blank is normal and expected: most phone and WhatsApp bookings arrive
    // with a name and a number, nothing else.
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email').max(254)]),
    phone: z.string().trim().max(40),
  }),
]);

const createSchema = z.object({
  customer: customerSchema,
  serviceId: z.string().min(1, 'Choose a service'),
  stylistId: z.string().min(1, 'Choose a stylist'),
  dateStr: z.string().regex(SALON_DATE_RE, 'Invalid date'),
  time: z.string().regex(SALON_TIME_RE, 'Invalid time'),
  durationMin: z.number().int().min(MIN_DURATION_MINUTES).max(12 * 60),
  // The salon is entering a booking it has already agreed with the customer, so
  // CONFIRMED is the normal case. PENDING stays available for "pencil this in".
  status: z.enum(['CONFIRMED', 'PENDING']),
  notes: z.string().max(1000),
  notifyCustomer: z.boolean(),
  overrideClashes: z.boolean(),
});

export type CreateAppointmentInput = z.infer<typeof createSchema>;

export type CreateAppointmentResult =
  | { success: true; appointmentId: string }
  | { success: false; error: string }
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
  const unauthorised = await requireAdmin();
  if (unauthorised) return { success: false, error: unauthorised };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' };
  }
  const { customer, serviceId, stylistId, dateStr, time, durationMin, status, notes, notifyCustomer, overrideClashes } = parsed.data;

  const salon = resolveSalonDateTime(dateStr, time);
  const date = salon.utc;
  if (Number.isNaN(date.getTime())) {
    return { success: false, error: 'Invalid date or time' };
  }

  const globalOffer = await getActiveGlobalOffer();

  try {
    const outcome = await runSerializableWithRetry(async (tx) => {
      const [service, stylist] = await Promise.all([
        tx.service.findUnique({
          where: { id: serviceId },
          select: { id: true, price: true, requiresPatchTest: true, treatwellExternalId: true },
        }),
        tx.stylist.findUnique({ where: { id: stylistId }, select: { id: true, isActive: true, treatwellExternalId: true } }),
      ]);
      if (!service) throw new BookingError('Service not found');
      if (!stylist) throw new BookingError('Stylist not found');
      if (!stylist.isActive) throw new BookingError('That stylist has been retired — pick someone on the current team.');

      const user = await resolveCustomer(tx, customer);

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
          priceAtBooking: applyOfferToPrice(Number(service.price), globalOffer),
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
    if (outcome.notify) {
      await dispatchAppointmentNotifications(outcome.appointmentId);
    }

    revalidateSchedule();
    return { success: true, appointmentId: outcome.appointmentId };
  } catch (error) {
    if (error instanceof BookingError) return { success: false, error: error.message };
    console.error('createAppointmentByAdmin failed', error);
    return { success: false, error: 'Could not create this booking. Please try again.' };
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
): Promise<{ id: string; email: string }> {
  if (customer.kind === 'existing') {
    const existing = await tx.user.findUnique({ where: { id: customer.userId }, select: { id: true, email: true } });
    if (!existing) throw new BookingError('That customer no longer exists — search again.');
    return existing;
  }

  if (customer.email) {
    const existing = await tx.user.findUnique({ where: { email: customer.email }, select: { id: true, email: true, role: true, phone: true } });
    if (existing) {
      // Fill a blank phone number in, but never overwrite what the customer
      // themselves set, and never edit an administrator's record.
      if (customer.phone && !existing.phone && existing.role !== 'ADMIN') {
        await tx.user.update({ where: { id: existing.id }, data: { phone: customer.phone } });
      }
      return { id: existing.id, email: existing.email };
    }
  }

  return tx.user.create({
    // randomUUID, not the name: two customers called "Mary Smith" must not
    // collide on the unique email column.
    data: {
      email: customer.email || placeholderEmailFor(randomUUID()),
      name: customer.name,
      phone: customer.phone || null,
    },
    select: { id: true, email: true },
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
  const unauthorised = await requireAdmin();
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
  revalidatePath('/admin');
  revalidatePath('/appointments');
  revalidatePath('/book');
}
