'use server';

import { createBooking, createBookingForFirstAvailable, getAvailableSlots, getAvailableSlotsUnion, getValidPatchTest, runSerializableWithRetry } from '@/app/services/booking-service';
import { resolveSalonDateTime, fitsWithinAvailability, isValidSalonTime, isValidSalonDate, salonDayWindow, SALON_TIME_RE, type SalonDateTime } from '@/app/services/salon-time';
import { SlotUnavailableError, BookingError } from '@/app/services/booking-errors';
import { hasConflict, type BookedInterval } from '@/app/services/scheduling';
import { loadExternalBusy, toBookedInterval } from '@/app/services/external-busy';
import { ANY_STYLIST_ID } from '@/app/lib/booking-constants';
import { sendBookingConfirmation, sendBookingCancellation, sendBookingReschedule } from '@/app/services/email-service';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Lazy so we never touch env at module load (per project convention). Limits
// discount-code checks per user to stop enumeration of valid codes.
let discountLimiter: Ratelimit | null | undefined;
function getDiscountLimiter(): Ratelimit | null {
  if (discountLimiter !== undefined) return discountLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  discountLimiter = url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(10, '15 m'),
        prefix: 'rl:discount',
      })
    : null;
  return discountLimiter;
}

// Limits booking creation per authenticated user to curb calendar-blockade abuse.
let bookingLimiter: Ratelimit | null | undefined;
function getBookingLimiter(): Ratelimit | null {
  if (bookingLimiter !== undefined) return bookingLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  bookingLimiter = url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(6, '1 h'),
        prefix: 'rl:booking',
      })
    : null;
  return bookingLimiter;
}

const MAX_ACTIVE_BOOKINGS = 6;

// serviceDuration is client-supplied. Bound it hard: an unvalidated negative or
// huge value drives the slot-generation loop in booking-service for millions of
// iterations (unauthenticated CPU/memory DoS — these slot actions require no session).
const SERVICE_DURATION = z.number().int().min(5).max(600);

const getSlotsSchema = z.object({
  stylistId: z.string().min(1).max(64),
  date: z.coerce.date(),
  serviceDuration: SERVICE_DURATION,
});

type CreateBookingInput = {
  stylistId: string;
  serviceId: string;
  date: Date | string;
  time: string;
  discountCode?: string;
  consultationForServiceId?: string;
};

const createBookingSchema = z.object({
  stylistId: z.string(),
  serviceId: z.string(),
  date: z.coerce.date(),
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
export async function fetchSlots(stylistId: string, date: Date, serviceDuration: number) {
  // Guard the client-supplied duration before it reaches the slot loop (see
  // SERVICE_DURATION note above) — this path has no Zod wrapper of its own.
  const duration = SERVICE_DURATION.safeParse(serviceDuration);
  if (!duration.success || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    return [];
  }
  try {
    if (stylistId === ANY_STYLIST_ID) {
      return await getAvailableSlotsUnion(date, duration.data);
    }
    return await getAvailableSlots(stylistId, date, duration.data);
  } catch (error) {
    console.error(error);
    return [];
  }
}

// Stylists available on a given weekday/time, in display (name) order — the
// candidate pool for resolving an "Anyone / first available" booking.
async function eligibleStylistIds(salon: SalonDateTime, durationMinutes: number): Promise<string[]> {
  const stylists = await prisma.stylist.findMany({
    where: { availabilities: { some: { dayOfWeek: salon.dayOfWeek, isOff: false } } },
    orderBy: { name: 'asc' },
    include: { availabilities: { where: { dayOfWeek: salon.dayOfWeek, isOff: false } } },
  });
  return stylists
    .filter((s) =>
      s.availabilities.some((a) => fitsWithinAvailability(salon.timeMinutes, durationMinutes, a.startTime, a.endTime)),
    )
    .map((s) => s.id);
}

export async function validateDiscountCode(code: string) {
  const session = await verifySession();
  if (!code) return { valid: false, error: 'Code is empty' };

  const limiter = getDiscountLimiter();
  if (limiter) {
    try {
      const { success } = await limiter.limit(`user:${session.userId}`);
      if (!success) return { valid: false, error: 'Too many attempts. Please try again shortly.' };
    } catch (err) {
      console.error('Discount rate limiter unavailable, allowing request:', err);
    }
  }

  try {
    const discount = await prisma.discountCode.findUnique({
      where: { code },
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
  // Require authentication
  const session = await verifySession();

  // Validate the input
  const result = createBookingSchema.safeParse(data);

  if (!result.success) {
    console.error('Validation failed:', result.error);
    return { success: false, error: 'Invalid booking data' };
  }

  const validData = result.data;

  // Per-user rate limit (fail open on Redis outage, matching the rest of the app).
  const limiter = getBookingLimiter();
  if (limiter) {
    try {
      const { success } = await limiter.limit(`user:${session.userId}`);
      if (!success) {
        return { success: false, error: 'Too many booking attempts. Please try again shortly.' };
      }
    } catch (err) {
      console.error('Booking rate limiter unavailable, allowing request:', err);
    }
  }

  // Hard cap on outstanding future bookings per user.
  const activeCount = await prisma.appointment.count({
    where: { userId: session.userId, status: 'CONFIRMED', date: { gt: new Date() } },
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

  // Prevent booking in the past
  if (fullDate <= new Date()) {
    return { success: false, error: 'Cannot book a time in the past' };
  }

  // Load the flags we gate on. A gated service must never be booked directly —
  // the client routes to a consultation, but a crafted request must be rejected.
  // Fetched here (before the stylist-hours resolution below) so `duration` is
  // available for the business-hours "must finish before closing" check.
  const service = await prisma.service.findUnique({
    where: { id: validData.serviceId },
    select: { duration: true, requiresPatchTest: true, requiresConsultation: true, isConsultation: true, isPatchTest: true },
  });
  if (!service) {
    return { success: false, error: 'Service not found' };
  }
  if (service?.requiresConsultation) {
    return { success: false, error: 'This service is by consultation only. Please book a consultation to discuss it.' };
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
  if ((service?.isConsultation || service?.isPatchTest) && validData.consultationForServiceId) {
    const origin = await prisma.service.findUnique({
      where: { id: validData.consultationForServiceId },
      select: { name: true },
    });
    if (origin) notes = `Consultation requested for: ${origin.name}`;
  }

  if (service?.requiresPatchTest) {
    const eligibility = await getValidPatchTest(session.userId, fullDate);
    if (!eligibility.ok) {
      const message =
        eligibility.reason === 'too_soon'
          ? 'Your patch test must be at least 48 hours before a colour appointment.'
          : eligibility.reason === 'expired'
            ? 'Your patch test has expired (valid for 6 months). Please book a new Consultation & Patch Test.'
            : 'Colour services require a completed Consultation & Patch Test first. Please book that appointment.';
      return { success: false, error: message };
    }
  }

  try {
    // The discount code is validated + claimed INSIDE the booking transaction
    // (see booking-service), so a failed booking never burns a code's usedCount.
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

    // Send confirmation email. A committed booking must never fail because an
    // email hiccups, so swallow send errors here (they now throw from email-service).
    try {
      await sendBookingConfirmation({
        id: appointment.id,
        date: appointment.date,
        user: appointment.user,
        stylist: appointment.stylist,
        service: {
          name: appointment.service.name,
          price: Number(appointment.service.price),
          duration: appointment.service.duration,
        },
      });
    } catch (emailError) {
      console.error('Booking confirmation email failed (booking still created):', emailError);
    }

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
      stylist: true,
      service: true,
    },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return { success: false, error: 'Appointment not found' };
  }

  if (appointment.status !== 'CONFIRMED') {
    return { success: false, error: 'Only confirmed appointments can be cancelled' };
  }

  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < 24) {
    return { success: false, error: 'Cannot cancel within 24 hours of appointment' };
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'CANCELLED' },
  });

  try {
    await sendBookingCancellation({
      ...appointment,
      service: { ...appointment.service, price: Number(appointment.service.price) },
    });
  } catch (emailError) {
    console.error('Cancellation email failed (appointment still cancelled):', emailError);
  }

  revalidatePath('/appointments');
  revalidatePath('/admin');
  revalidatePath('/book');
  return { success: true };
}

export async function checkColourEligibility(serviceId: string, dateIso: string) {
  const session = await verifySession();
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { requiresPatchTest: true },
  });
  if (!service?.requiresPatchTest) {
    return { requiresTest: false, eligible: true, reason: 'eligible' as const, testDate: null };
  }
  const eligibility = await getValidPatchTest(session.userId, new Date(dateIso));
  return {
    requiresTest: true,
    eligible: eligibility.ok,
    reason: eligibility.reason,
    testDate: eligibility.testDate ? eligibility.testDate.toISOString() : null,
  };
}

export async function rescheduleAppointment(appointmentId: string, dateStr: string, time: string) {
  const session = await verifySession();

  // Reject malformed date/time before any DB work (no Zod schema on this path).
  if (!isValidSalonDate(dateStr) || !isValidSalonTime(time)) {
    return { success: false, error: 'Invalid date or time' };
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      user: { select: { email: true, name: true } },
      stylist: true,
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
          durationMin: appt.service.duration,
        })),
        ...externalBlocks.map(toBookedInterval),
      ];

      if (hasConflict(newDate, appointment.service.duration, blocking)) {
        throw new SlotUnavailableError('This time slot is no longer available.');
      }

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { date: newDate, reminderSent: false },
      });
    });

    const updated = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        user: { select: { email: true, name: true } },
        stylist: true,
        service: true,
      },
    });

    if (updated) {
      try {
        await sendBookingReschedule(
          { ...updated, service: { ...updated.service, price: Number(updated.service.price) } },
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
