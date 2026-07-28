'use server';

import { createBooking, createBookingForFirstAvailable, getAvailableSlots, getAvailableSlotsUnion, getValidPatchTest, runSerializableWithRetry } from '@/app/services/booking-service';
import { evaluateBookingGates, type PatchTestGateReason } from '@/app/services/booking-gates';
import { resolveSalonDateTime, fitsWithinAvailability, isValidSalonTime, isValidSalonDate, salonDayWindow, SALON_TIME_RE, SALON_DATE_RE, type SalonDateTime } from '@/app/services/salon-time';
import { SlotUnavailableError, BookingError } from '@/app/services/booking-errors';
import { hasConflict, type BookedInterval } from '@/app/services/scheduling';
import { loadExternalBusy, toBookedInterval } from '@/app/services/external-busy';
import { ANY_STYLIST_ID } from '@/app/lib/booking-constants';
import {
  sendBookingCancellation,
  sendBookingReschedule,
  sendBookingRequestReceived,
  sendNewBookingAlert,
} from '@/app/services/email-service';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { bookingLimiter, discountLimiter } from '@/app/lib/rate-limit';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from '@/app/services/treatwell-api';
import { isBookingEnabled, BOOKING_MAINTENANCE_MESSAGE } from '@/app/lib/booking-maintenance';

// discountLimiter stops enumeration of valid discount codes; bookingLimiter
// curbs calendar-blockade abuse. Both come from lib/rate-limit.ts, which falls
// back to in-process limiting when Upstash is unconfigured — these two call
// sites previously skipped limiting entirely in that case.

const MAX_ACTIVE_BOOKINGS = 6;

// serviceDuration is client-supplied. Bound it hard: an unvalidated negative or
// huge value drives the slot-generation loop in booking-service for millions of
// iterations (unauthenticated CPU/memory DoS — these slot actions require no session).
const SERVICE_DURATION = z.number().int().min(5).max(600);

const getSlotsSchema = z.object({
  stylistId: z.string().min(1).max(64),
  // Salon-local calendar day (YYYY-MM-DD) — the day the customer SAW. A coerced
  // Date would carry the browser's local-midnight instant and split the grid,
  // conflict window and weekday across three timezone frames downstream.
  date: z.string().regex(SALON_DATE_RE, 'Invalid date'),
  serviceDuration: SERVICE_DURATION,
});

type CreateBookingInput = {
  stylistId: string;
  serviceId: string;
  date: string;
  time: string;
  discountCode?: string;
  consultationForServiceId?: string;
};

const createBookingSchema = z.object({
  stylistId: z.string(),
  serviceId: z.string(),
  // Salon-local calendar day (YYYY-MM-DD); resolveSalonDateTime turns it +
  // `time` into the correct absolute instant (see getSlotsSchema note).
  date: z.string().regex(SALON_DATE_RE, 'Invalid date'),
  time: z.string().regex(SALON_TIME_RE, 'Invalid time'), // strict HH:mm
  discountCode: z.string().optional(),
  consultationForServiceId: z.string().optional(),
}) satisfies z.ZodType<CreateBookingInput>;

// Shared business-hours guard for a resolved salon date/time against a stylist's
// availability for that weekday. Used by both the create and reschedule paths.
async function checkStylistHours(
  stylistId: string,
  salon: SalonDateTime,
  durationMinutes: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const availability = await prisma.availability.findFirst({
    where: { stylistId, dayOfWeek: salon.dayOfWeek, isOff: false },
  });
  if (!availability) {
    return { ok: false, error: 'Stylist is not available on this day' };
  }
  if (!fitsWithinAvailability(salon.timeMinutes, durationMinutes, availability.startTime, availability.endTime)) {
    return { ok: false, error: 'Selected time is outside business hours' };
  }
  return { ok: true };
}

export async function getAvailableSlotsAction(prevState: unknown, formData: FormData) {
  if (!(await isBookingEnabled())) {
    return { error: BOOKING_MAINTENANCE_MESSAGE };
  }

  const stylistId = formData.get('stylistId') as string;
  const dateStr = formData.get('date') as string;
  const serviceDuration = Number(formData.get('serviceDuration'));

  const validated = getSlotsSchema.safeParse({
    stylistId,
    date: dateStr,
    serviceDuration,
  });

  if (!validated.success) {
    return { error: 'Invalid input data' };
  }

  try {
    const slots = await getAvailableSlots(
      validated.data.stylistId,
      validated.data.date,
      validated.data.serviceDuration
    );
    return { slots };
  } catch (error) {
    console.error('Error fetching slots:', error);
    return { error: 'Failed to fetch available slots' };
  }
}

// Helper for client-side fetching without form state. The "Anyone" option
// returns the union of every stylist's availability.
export type FetchSlotsResult =
  | { ok: true; slots: Awaited<ReturnType<typeof getAvailableSlots>> }
  | { ok: false };

export async function fetchSlots(
  stylistId: string,
  date: string,
  serviceDuration: number,
): Promise<FetchSlotsResult> {
  if (!(await isBookingEnabled())) {
    return { ok: true, slots: [] };
  }

  // Guard the client-supplied duration before it reaches the slot loop (see
  // SERVICE_DURATION note above) — this path has no Zod wrapper of its own.
  // `date` is the salon-local calendar day (YYYY-MM-DD) the customer saw.
  const duration = SERVICE_DURATION.safeParse(serviceDuration);
  if (!duration.success || !isValidSalonDate(date)) {
    return { ok: true, slots: [] };
  }
  try {
    const slots =
      stylistId === ANY_STYLIST_ID
        ? await getAvailableSlotsUnion(date, duration.data)
        : await getAvailableSlots(stylistId, date, duration.data);
    return { ok: true, slots };
  } catch (error) {
    // A lookup failure is NOT "no availability" — return a distinct result so the
    // UI can say "couldn't load" instead of silently implying the day is full.
    console.error('fetchSlots failed', { stylistId, date, duration: duration.data }, error);
    return { ok: false };
  }
}

// Stylists available on a given weekday/time, in display (name) order — the
// candidate pool for resolving an "Anyone / first available" booking.
async function eligibleStylistIds(salon: SalonDateTime, durationMinutes: number): Promise<string[]> {
  const stylists = await prisma.stylist.findMany({
    where: { availabilities: { some: { dayOfWeek: salon.dayOfWeek, isOff: false } } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      availabilities: {
        where: { dayOfWeek: salon.dayOfWeek, isOff: false },
        select: { startTime: true, endTime: true },
      },
    },
  });
  return stylists
    .filter((s) =>
      s.availabilities.some((a) => fitsWithinAvailability(salon.timeMinutes, durationMinutes, a.startTime, a.endTime)),
    )
    .map((s) => s.id);
}

export async function validateDiscountCode(code: string) {
  const session = await verifySession();
  // Codes are stored upper-cased (admin.ts), so normalise the customer's input —
  // otherwise someone typing "summer20" on a phone gets "Invalid code".
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { valid: false, error: 'Code is empty' };

  if (!(await discountLimiter.check(`user:${session.userId}`))) {
    return { valid: false, error: 'Too many attempts. Please try again shortly.' };
  }

  try {
    const discount = await prisma.discountCode.findUnique({
      where: { code: normalized },
    });

    if (!discount) return { valid: false, error: 'Invalid code' };
    if (!discount.isActive) return { valid: false, error: 'Code is inactive' };
    if (discount.expiresAt && new Date() > discount.expiresAt) return { valid: false, error: 'Code has expired' };
    if (discount.maxUses && discount.usedCount >= discount.maxUses) return { valid: false, error: 'Code usage limit reached' };

    return {
      valid: true,
      type: discount.type,
      value: Number(discount.value),
    };
  } catch (error) {
    console.error('Error validating discount code:', error);
    return { valid: false, error: 'Validation failed' };
  }
}

export async function submitBooking(data: z.infer<typeof createBookingSchema>) {
  // Hard server-side block while online booking is in maintenance — checked
  // before anything else so no client (or direct action call) can bypass it.
  if (!(await isBookingEnabled())) {
    return { success: false, error: BOOKING_MAINTENANCE_MESSAGE };
  }

  // Require authentication
  const session = await verifySession();

  // Validate the input
  const result = createBookingSchema.safeParse(data);

  if (!result.success) {
    console.error('Validation failed:', result.error);
    return { success: false, error: 'Invalid booking data' };
  }

  const validData = result.data;

  // Per-user rate limit. Degrades to in-process limiting on a Redis outage or
  // missing config, rather than failing open.
  if (!(await bookingLimiter.check(`user:${session.userId}`))) {
    return { success: false, error: 'Too many booking attempts. Please try again shortly.' };
  }

  // Hard cap on outstanding future bookings per user. PENDING requests count
  // too — otherwise a user could stack unlimited unapproved requests.
  const activeCount = await prisma.appointment.count({
    where: { userId: session.userId, status: { in: ['PENDING', 'CONFIRMED'] }, date: { gt: new Date() } },
  });
  if (activeCount >= MAX_ACTIVE_BOOKINGS) {
    return { success: false, error: 'You already have the maximum number of upcoming bookings. Please manage your existing appointments first.' };
  }

  // Resolve the salon wall-clock time to the correct absolute UTC instant
  // (handles BST/GMT). Host-timezone independent — see salon-time.ts.
  const salon = resolveSalonDateTime(validData.date, validData.time);
  const fullDate = salon.utc;

  // Defensive: reject an unparseable date/time before it reaches the DB.
  if (Number.isNaN(fullDate.getTime())) {
    return { success: false, error: 'Invalid date or time' };
  }

  // Load the flags we gate on. Fetched here (before the stylist-hours resolution
  // below) so `duration` is available for the business-hours "must finish before
  // closing" check, and so requiresPatchTest is known before deciding whether to
  // fetch patch-test eligibility below.
  const service = await prisma.service.findUnique({
    where: { id: validData.serviceId },
    select: { duration: true, requiresPatchTest: true, requiresConsultation: true, isConsultation: true, isPatchTest: true },
  });
  if (!service) {
    return { success: false, error: 'Service not found' };
  }

  // Patch-test eligibility is only relevant — and only fetched — for services
  // that require it. Non-gated services pass an "eligible" placeholder through;
  // evaluateBookingGates ignores patchTestEligible/patchTestReason entirely when
  // requiresPatchTest is false.
  let patchTestEligible = true;
  let patchTestReason: PatchTestGateReason = 'eligible';
  if (service.requiresPatchTest) {
    const eligibility = await getValidPatchTest(session.userId, fullDate);
    patchTestEligible = eligibility.ok;
    patchTestReason = eligibility.reason;
  }

  // Consultation-only rejection, past-date rejection, and the colour patch-test
  // gate are decided together by the pure evaluateBookingGates — see
  // booking-gates.ts for the exact ordering this preserves (past-date, then
  // consultation-only, then patch-test — matching this file's historical order).
  const gate = evaluateBookingGates({
    requiresConsultation: service.requiresConsultation,
    requiresPatchTest: service.requiresPatchTest,
    patchTestEligible,
    patchTestReason,
    bookingInstant: fullDate,
    now: new Date(),
  });
  if (!gate.ok) {
    return { success: false, error: gate.error };
  }

  // Resolve which stylist(s) can take this slot. For a named stylist we validate
  // their hours; for "Anyone" we gather every stylist available at this time.
  const isAnyStylist = validData.stylistId === ANY_STYLIST_ID;
  let candidateStylistIds: string[] = [];
  if (isAnyStylist) {
    candidateStylistIds = await eligibleStylistIds(salon, service.duration);
    if (candidateStylistIds.length === 0) {
      return { success: false, error: 'No stylist is available at this time' };
    }
  } else {
    const hoursCheck = await checkStylistHours(validData.stylistId, salon, service.duration);
    if (!hoursCheck.ok) {
      return { success: false, error: hoursCheck.error };
    }
  }

  // If this booking IS a consultation target, record which service it's for.
  let notes: string | undefined;
  if ((service.isConsultation || service.isPatchTest) && validData.consultationForServiceId) {
    const origin = await prisma.service.findUnique({
      where: { id: validData.consultationForServiceId },
      select: { name: true },
    });
    if (origin) notes = `Consultation requested for: ${origin.name}`;
  }

  try {
    // The discount code is validated + claimed INSIDE the booking transaction
    // (see booking-service), so a failed booking never burns a code's usedCount.
    // No CONFIRMATION email is sent here: the booking is only a PENDING request
    // at this point. The confirmation email goes out when an admin approves it —
    // see updateAppointmentStatus in actions/admin.ts. What is sent below is the
    // customer's "we got your request" acknowledgement plus the salon's alert.
    const appointment = isAnyStylist
      ? await createBookingForFirstAvailable({
          candidateStylistIds,
          serviceId: validData.serviceId,
          date: fullDate,
          userId: session.userId,
          discountCode: validData.discountCode,
          notes,
        })
      : await createBooking({
          stylistId: validData.stylistId,
          serviceId: validData.serviceId,
          date: fullDate,
          userId: session.userId,
          discountCode: validData.discountCode,
          notes,
        });

    // Tell BOTH sides that a request landed. Neither send may fail the booking —
    // it is already committed — so each is caught and logged independently.
    //
    // Before this, a PENDING request produced total silence: the customer had no
    // acknowledgement (the confirmation email only goes out on admin approval)
    // and the salon had no signal at all, so requests sat unactioned until
    // someone happened to open the admin dashboard.
    // Show the price actually recorded for this booking (global offer applied),
    // so the email matches what the public pages advertised — not the list price.
    const priceNumber = Number(appointment.priceAtBooking ?? appointment.service.price);
    await Promise.allSettled([
      (async () => {
        try {
          const settings = await getSiteSettings();
          await sendBookingRequestReceived(
            { ...appointment, service: { ...appointment.service, price: priceNumber } },
            settings.phone,
          );
        } catch (emailError) {
          console.error('Request-received email failed (booking still created):', emailError);
        }
      })(),
      (async () => {
        try {
          await sendNewBookingAlert({
            ...appointment,
            service: { ...appointment.service, price: priceNumber },
          });
        } catch (emailError) {
          console.error('Salon new-booking alert failed (booking still created):', emailError);
        }
      })(),
    ]);

    revalidatePath('/book');
    revalidatePath('/appointments');
    revalidatePath('/admin');
    return { success: true };
  } catch (error) {
    console.error('Booking failed:', error);
    // Only surface customer-safe messages (slot taken, discount unavailable);
    // anything else (Prisma/internal) becomes a generic message.
    const message = error instanceof BookingError ? error.message : 'Failed to create booking';
    return { success: false, error: message };
  }
}

export async function cancelAppointment(appointmentId: string) {
  const session = await verifySession();

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      user: { select: { email: true, name: true } },
      stylist: { select: { name: true, treatwellExternalId: true } },
      service: true,
    },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return { success: false, error: 'Appointment not found' };
  }

  if (appointment.status !== 'CONFIRMED' && appointment.status !== 'PENDING') {
    return { success: false, error: 'Only pending or confirmed appointments can be cancelled' };
  }

  // The 24-hour rule only protects slots the salon has actually confirmed; a
  // customer may withdraw a still-PENDING request at any time.
  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (appointment.status === 'CONFIRMED' && hoursUntil < 24) {
    return { success: false, error: 'Cannot cancel within 24 hours of appointment' };
  }

  const treatwellApi = getTreatwellApiConfiguration();
  const treatwellSyncStatus = changedTreatwellSyncStatus({
    apiReady: treatwellApi.enabled && treatwellApi.configured,
    treatwellBookingId: appointment.treatwellBookingId,
    stylistExternalId: appointment.stylist.treatwellExternalId,
    serviceExternalId: appointment.service.treatwellExternalId,
  });

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'CANCELLED', treatwellSyncStatus, treatwellSyncError: null },
  });

  try {
    await sendBookingCancellation({
      ...appointment,
      service: { ...appointment.service, price: Number(appointment.priceAtBooking ?? appointment.service.price) },
    });
  } catch (emailError) {
    console.error('Cancellation email failed (appointment still cancelled):', emailError);
  }

  revalidatePath('/appointments');
  revalidatePath('/admin');
  revalidatePath('/book');
  return { success: true };
}

export async function checkColourEligibility(serviceId: string, dateStr: string) {
  const session = await verifySession();
  // Salon-local calendar day (YYYY-MM-DD), matching the wizard grid. Resolve it
  // to a stable in-day instant (salon noon) rather than trusting a browser-local
  // Date, so the patch-test window is evaluated against the day the customer saw.
  if (!isValidSalonDate(dateStr)) {
    return { requiresTest: false, eligible: true, reason: 'eligible' as const, testDate: null };
  }
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { requiresPatchTest: true },
  });
  if (!service?.requiresPatchTest) {
    return { requiresTest: false, eligible: true, reason: 'eligible' as const, testDate: null };
  }
  const eligibility = await getValidPatchTest(session.userId, resolveSalonDateTime(dateStr, '12:00').utc);
  return {
    requiresTest: true,
    eligible: eligibility.ok,
    reason: eligibility.reason,
    testDate: eligibility.testDate ? eligibility.testDate.toISOString() : null,
  };
}

export async function rescheduleAppointment(appointmentId: string, dateStr: string, time: string) {
  // Rescheduling books a new slot, so it is blocked during maintenance too.
  // (Cancellation stays available — see cancelAppointment.)
  if (!(await isBookingEnabled())) {
    return { success: false, error: BOOKING_MAINTENANCE_MESSAGE };
  }

  const session = await verifySession();

  // Reject malformed date/time before any DB work (no Zod schema on this path).
  if (!isValidSalonDate(dateStr) || !isValidSalonTime(time)) {
    return { success: false, error: 'Invalid date or time' };
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      user: { select: { email: true, name: true } },
      stylist: { select: { name: true, treatwellExternalId: true } },
      service: true,
    },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return { success: false, error: 'Appointment not found' };
  }

  if (appointment.status !== 'CONFIRMED') {
    return { success: false, error: 'Only confirmed appointments can be rescheduled' };
  }

  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < 24) {
    return { success: false, error: 'Cannot reschedule within 24 hours of appointment' };
  }

  // Resolve the new salon wall-clock time to the correct absolute UTC instant
  // (handles BST/GMT) — the create path did this but reschedule previously did not.
  const salon = resolveSalonDateTime(dateStr, time);
  const newDate = salon.utc;

  // Defensive: reject an unparseable instant before it reaches the DB.
  if (Number.isNaN(newDate.getTime())) {
    return { success: false, error: 'Invalid date or time' };
  }

  // Prevent rescheduling into the past
  if (newDate <= new Date()) {
    return { success: false, error: 'Cannot reschedule to a time in the past' };
  }

  // Validate the new time falls within stylist availability for this day
  const hoursCheck = await checkStylistHours(appointment.stylistId, salon, appointment.service.duration);
  if (!hoursCheck.ok) {
    return { success: false, error: hoursCheck.error };
  }

  // Re-validate the colour patch-test gate against the NEW date.
  if (appointment.service.requiresPatchTest) {
    const eligibility = await getValidPatchTest(session.userId, newDate);
    if (!eligibility.ok) {
      const message =
        eligibility.reason === 'too_soon'
          ? 'Your patch test must be at least 48 hours before a colour appointment.'
          : eligibility.reason === 'expired'
            ? 'Your patch test has expired (valid for 6 months). Please book a new Consultation & Patch Test.'
            : 'Colour services require a completed Consultation & Patch Test first.';
      return { success: false, error: message };
    }
  }

  try {
    const oldDate = appointment.date;

    await runSerializableWithRetry(async (tx) => {
      const { start: dayStart, end: dayEnd } = salonDayWindow(newDate);

      const existingAppointments = await tx.appointment.findMany({
        where: {
          stylistId: appointment.stylistId,
          date: { gte: dayStart, lte: dayEnd },
          status: { not: 'CANCELLED' },
          id: { not: appointmentId },
        },
        include: { service: { select: { duration: true } } },
      });

      // Treatwell (external) busy blocks count as conflicts too — the create
      // paths already do this; reschedule previously skipped them, allowing a
      // customer to reschedule directly onto a Treatwell-booked slot.
      const externalBlocks = await loadExternalBusy(tx, [appointment.stylistId], { start: dayStart, end: dayEnd });
      const blocking: BookedInterval[] = [
        ...existingAppointments.map((appt) => ({
          start: new Date(appt.date),
          // Prefer the duration frozen at booking time (see booking-service).
          durationMin: appt.durationAtBooking ?? appt.service.duration,
        })),
        ...externalBlocks.map(toBookedInterval),
      ];

      if (hasConflict(newDate, appointment.service.duration, blocking)) {
        throw new SlotUnavailableError('This time slot is no longer available.');
      }

      const treatwellApi = getTreatwellApiConfiguration();
      const treatwellSyncStatus = changedTreatwellSyncStatus({
        apiReady: treatwellApi.enabled && treatwellApi.configured,
        treatwellBookingId: appointment.treatwellBookingId,
        stylistExternalId: appointment.stylist.treatwellExternalId,
        serviceExternalId: appointment.service.treatwellExternalId,
      });

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { date: newDate, reminderSent: false, treatwellSyncStatus, treatwellSyncError: null },
      });
    });

    const updated = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        user: { select: { email: true, name: true } },
        stylist: { select: { name: true, treatwellExternalId: true } },
        service: true,
      },
    });

    if (updated) {
      try {
        await sendBookingReschedule(
          { ...updated, service: { ...updated.service, price: Number(updated.priceAtBooking ?? updated.service.price) } },
          oldDate,
        );
      } catch (emailError) {
        console.error('Reschedule email failed (appointment still rescheduled):', emailError);
      }
    }

    revalidatePath('/appointments');
    revalidatePath('/admin');
    revalidatePath('/book');
    return { success: true };
  } catch (error) {
    console.error('Reschedule failed:', error);
    const message = error instanceof BookingError ? error.message : 'Reschedule failed. Please try again.';
    return { success: false, error: message };
  }
}
