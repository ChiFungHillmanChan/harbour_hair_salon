'use server';

import { createBooking, createBookingForFirstAvailable, getAvailableSlots, getAvailableSlotsUnion, getBookingDays, getValidPatchTest, runSerializableWithRetry, assertAppointmentSlotAvailable } from '@/app/services/booking-service';
import type { BookingDay } from '@/app/services/booking-days';
import { revalidatePath } from 'next/cache';
import { evaluateBookingGates, type PatchTestGateReason } from '@/app/services/booking-gates';
import { resolveSalonDateTime, fitsWithinAvailability, isValidSalonTime, isValidSalonDate, SALON_TIME_RE, SALON_DATE_RE, type SalonDateTime } from '@/app/services/salon-time';
import { BookingError, bookingErrorText, describeBookingError, type BookingErrorCode } from '@/app/services/booking-errors';
import { PriceChangedError } from '@/app/services/booking-service';
import { getActionLocale } from '@/i18n/request';
import type { Locale } from '@/i18n/config';
import type { PriceQuote } from '@/app/services/pricing/quote';
import { ANY_STYLIST_ID, BOOKING_DAYS_MAX } from '@/app/lib/booking-constants';
import { enqueueAppointmentNotification, dispatchAppointmentNotifications } from '@/app/services/notification-outbox-service';
import { verifySession } from '@/app/lib/session';
import { after } from 'next/server';
import { invalidateStylistIcalFeed } from '@/app/services/stylist-ical-cache';
import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { appointmentRescheduleLimiter, availabilityLimiter, bookingLimiter, rescheduleLimiter } from '@/app/lib/rate-limit';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from '@/app/services/treatwell-api';
import { isBookingEnabled, assertOnlineBookingReady } from '@/app/lib/booking-maintenance';
import { isBookableDateWindow } from '@/app/services/booking-horizon';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { headers } from 'next/headers';

// bookingLimiter curbs calendar-blockade abuse. It comes from lib/rate-limit.ts,
// which falls back to in-process limiting when Upstash is unconfigured. (The
// discount-code limiter went with the codes themselves: while discounts are
// paused no code is ever looked up, so there is nothing to enumerate.)

/** A failed action result in the caller's language. */
function failure(locale: Locale, code: BookingErrorCode) {
  return { success: false as const, code, error: bookingErrorText(locale, code) };
}

// The availability lookups need no session, so they are limited per address.
async function availabilityAllowed(): Promise<boolean> {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return availabilityLimiter.check(ip);
}

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
  /** The price the customer saw and confirmed (see pricing/quote.ts). */
  expectedQuote?: { serviceId: string; priceVersion: number; amountPence: number };
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
  expectedQuote: z.object({
    serviceId: z.string().min(1).max(64),
    priceVersion: z.number().int().min(0),
    amountPence: z.number().int().min(0),
  }).optional(),
}) satisfies z.ZodType<CreateBookingInput>;

// Shared business-hours guard for a resolved salon date/time against a stylist's
// availability for that weekday. Used by both the create and reschedule paths.
async function checkStylistHours(
  stylistId: string,
  salon: SalonDateTime,
  durationMinutes: number,
): Promise<{ ok: true } | { ok: false; code: BookingErrorCode }> {
  const availability = await prisma.availability.findFirst({
    where: { stylistId, dayOfWeek: salon.dayOfWeek, isOff: false, stylist: { isActive: true } },
    select: { startTime: true, endTime: true },
  });
  if (!availability) {
    return { ok: false, code: 'STYLIST_OFF_THAT_DAY' };
  }
  if (!fitsWithinAvailability(salon.timeMinutes, durationMinutes, availability.startTime, availability.endTime)) {
    return { ok: false, code: 'OUTSIDE_HOURS' };
  }
  return { ok: true };
}

export async function getAvailableSlotsAction(prevState: unknown, formData: FormData) {
  const locale = await getActionLocale();
  if (!(await isBookingEnabled())) {
    return { error: bookingErrorText(locale, 'MAINTENANCE') };
  }

  const stylistId = formData.get('stylistId') as string;
  const dateStr = formData.get('date') as string;
  const serviceDuration = Number(formData.get('serviceDuration'));

  const validated = getSlotsSchema.safeParse({
    stylistId,
    date: dateStr,
    serviceDuration,
  });

  if (!validated.success || !isBookableDateWindow([validated.data.date])) {
    return { error: bookingErrorText(locale, 'INVALID_INPUT') };
  }
  if (!(await availabilityAllowed())) {
    return { error: bookingErrorText(locale, 'TOO_MANY_ATTEMPTS') };
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
    return { error: bookingErrorText(locale, 'SLOTS_FAILED') };
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
  if (!duration.success || !isBookableDateWindow([date])) {
    return { ok: true, slots: [] };
  }
  if (!(await availabilityAllowed())) {
    return { ok: false };
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

export type FetchBookingDaysResult = { ok: true; days: BookingDay[] } | { ok: false };

/**
 * The booking page's whole date strip in one request: each day's status, hours
 * and every time (taken ones greyed). Same gate and input rules as fetchSlots:
 * real calendar days, inside the bookable window, at most a fortnight apart.
 */
export async function fetchBookingDays(
  stylistId: string,
  dates: string[],
  serviceDuration: number,
): Promise<FetchBookingDaysResult> {
  if (!(await isBookingEnabled())) {
    return { ok: true, days: [] };
  }
  const duration = SERVICE_DURATION.safeParse(serviceDuration);
  const validDates = Array.isArray(dates) && dates.length > 0 && dates.length <= BOOKING_DAYS_MAX &&
    isBookableDateWindow(dates);
  if (!duration.success || typeof stylistId !== 'string' || !stylistId || !validDates) {
    return { ok: true, days: [] };
  }
  if (!(await availabilityAllowed())) {
    return { ok: false };
  }
  try {
    return { ok: true, days: await getBookingDays(stylistId, [...new Set(dates)], duration.data) };
  } catch (error) {
    // A lookup failure is NOT "unavailable" — the page says "couldn't load" instead.
    console.error('fetchBookingDays failed', { stylistId, days: dates.length, duration: duration.data }, error);
    return { ok: false };
  }
}

// Stylists available on a given weekday/time, in display (name) order — the
// candidate pool for resolving an "Anyone / first available" booking.
async function eligibleStylistIds(salon: SalonDateTime, durationMinutes: number): Promise<string[]> {
  const stylists = await prisma.stylist.findMany({
    where: { isActive: true, availabilities: { some: { dayOfWeek: salon.dayOfWeek, isOff: false } } },
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

/**
 * Kept for pages opened before discounts were paused, which still call it.
 * It never looks a code up — no enumeration, no validation, no usage count —
 * and always answers with the pause, so an old tab cannot show a discounted
 * total. See DISCOUNTS_PAUSED in services/pricing/policy.ts.
 */
export async function validateDiscountCode(code: string) {
  await verifySession();
  void code;
  return { valid: false as const, paused: true as const, error: bookingErrorText(await getActionLocale(), 'DISCOUNTS_PAUSED') };
}

/** The part of a quote the booking page needs to show and re-confirm a price. */
export type ClientQuote = Pick<PriceQuote, 'serviceId' | 'priceVersion' | 'amountPence' | 'priceType' | 'vatDisplay' | 'priceNature' | 'breakdown'>;

function toClientQuote(quote: PriceQuote): ClientQuote {
  const { serviceId, priceVersion, amountPence, priceType, vatDisplay, priceNature, breakdown } = quote;
  return { serviceId, priceVersion, amountPence, priceType, vatDisplay, priceNature, breakdown };
}

export type SubmitBookingResult =
  | { success: true }
  | { success: false; code?: BookingErrorCode; error: string; quote?: ClientQuote };

export async function submitBooking(data: z.infer<typeof createBookingSchema>): Promise<SubmitBookingResult> {
  const locale = await getActionLocale();
  // Hard server-side block while online booking is in maintenance — checked
  // before anything else so no client (or direct action call) can bypass it.
  if (!(await isBookingEnabled())) {
    return failure(locale, 'MAINTENANCE');
  }

  // Require authentication
  const session = await verifySession();

  // Validate the input
  const result = createBookingSchema.safeParse(data);

  if (!result.success) {
    console.error('Validation failed:', result.error);
    return failure(locale, 'INVALID_BOOKING');
  }

  const validData = result.data;

  // Discounts are paused: answer an old page that still sends a code before
  // any lookup, so the code is neither applied nor counted.
  if (validData.discountCode?.trim()) {
    return failure(locale, 'DISCOUNTS_PAUSED');
  }

  // Per-user rate limit. Degrades to in-process limiting on a Redis outage or
  // missing config, rather than failing open.
  if (!(await bookingLimiter.check(`user:${session.userId}`))) {
    return failure(locale, 'TOO_MANY_BOOKINGS');
  }

  // Resolve the salon wall-clock time to the correct absolute UTC instant
  // (handles BST/GMT). Host-timezone independent — see salon-time.ts.
  const salon = resolveSalonDateTime(validData.date, validData.time);
  const fullDate = salon.utc;

  // Defensive: reject an unparseable date/time before it reaches the DB.
  if (Number.isNaN(fullDate.getTime())) {
    return failure(locale, 'INVALID_DATE_TIME');
  }

  // Load the flags we gate on. Fetched here (before the stylist-hours resolution
  // below) so `duration` is available for the business-hours "must finish before
  // closing" check, and so requiresPatchTest is known before deciding whether to
  // fetch patch-test eligibility below.
  const service = await prisma.service.findUnique({
    where: { id: validData.serviceId },
    select: { duration: true, requiresPatchTest: true, requiresConsultation: true, isConsultation: true, isPatchTest: true, isBookable: true, isPublic: true },
  });
  if (!service) {
    return failure(locale, 'SERVICE_NOT_FOUND');
  }
  // Retired and not-yet-bookable options (e.g. an unverified NHS price) are
  // refused here too, not just hidden: an old page or a crafted request can
  // still send their id. Existing appointments for them are unaffected.
  if (!service.isBookable || !service.isPublic) {
    return failure(locale, 'SERVICE_NOT_BOOKABLE');
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
    return failure(locale, gate.code);
  }

  // Resolve which stylist(s) can take this slot. For a named stylist we validate
  // their hours; for "Anyone" we gather every stylist available at this time.
  const isAnyStylist = validData.stylistId === ANY_STYLIST_ID;
  let candidateStylistIds: string[] = [];
  if (isAnyStylist) {
    candidateStylistIds = await eligibleStylistIds(salon, service.duration);
    if (candidateStylistIds.length === 0) {
      return failure(locale, 'NO_STYLIST_AT_TIME');
    }
  } else {
    const hoursCheck = await checkStylistHours(validData.stylistId, salon, service.duration);
    if (!hoursCheck.ok) {
      return failure(locale, hoursCheck.code);
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
          notes,
          // Without an expectation the page never showed a server price
          // (an old tab): force a fresh confirmation rather than guess.
          expectedQuote: validData.expectedQuote ?? null,
          locale,
        })
      : await createBooking({
          stylistId: validData.stylistId,
          serviceId: validData.serviceId,
          date: fullDate,
          userId: session.userId,
          notes,
          expectedQuote: validData.expectedQuote ?? null,
          locale,
        });



    // The marketplaces poll a cached feed; drop it so the new busy period is
    // visible on their next poll rather than whenever the window expires.
    invalidateStylistIcalFeed();
    // Next flushes cache invalidation when the action finishes. Keep delivery
    // after the response so slow email cannot hold the busy feed stale.
    after(async () => {
      await dispatchAppointmentNotifications(appointment.id);
      // Remember the language for mail the salon later sends on the customer's
      // behalf (e.g. a booking an administrator enters for them). Best effort
      // and after the response: the booking already records its own language,
      // so this can never turn a made booking into an error.
      try {
        await prisma.user.update({ where: { id: session.userId }, data: { preferredLocale: locale } });
      } catch {
        // Preference only.
      }
    });
    revalidateAllLocales(revalidatePath, '/book');
    revalidateAllLocales(revalidatePath, '/appointments');
    revalidateAllLocales(revalidatePath, '/admin');
    return { success: true };
  } catch (error) {
    if (error instanceof PriceChangedError) {
      return { success: false, code: 'PRICE_CHANGED', error: error.localized(locale), quote: toClientQuote(error.quote) };
    }
    console.error('Booking failed:', error);
    // Only surface customer-safe messages (slot taken, price changed);
    // anything else (Prisma/internal) becomes a generic message.
    return { success: false, code: error instanceof BookingError ? error.code : 'BOOKING_FAILED', error: describeBookingError(error, locale, 'BOOKING_FAILED') };
  }
}

export async function cancelAppointment(appointmentId: string) {
  const session = await verifySession();
  const locale = await getActionLocale();

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      user: { select: { email: true, name: true } },
      stylist: { select: { name: true, treatwellExternalId: true } },
      service: true,
    },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return failure(locale, 'APPOINTMENT_NOT_FOUND');
  }

  if (appointment.status !== 'CONFIRMED' && appointment.status !== 'PENDING') {
    return failure(locale, 'CANCEL_ONLY_ACTIVE');
  }

  // The 24-hour rule only protects slots the salon has actually confirmed; a
  // customer may withdraw a still-PENDING request at any time.
  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (appointment.status === 'CONFIRMED' && hoursUntil < 24) {
    return failure(locale, 'CANCEL_TOO_LATE');
  }

  const treatwellApi = getTreatwellApiConfiguration();
  const treatwellSyncStatus = changedTreatwellSyncStatus({
    apiReady: treatwellApi.enabled && treatwellApi.configured,
    treatwellBookingId: appointment.treatwellBookingId,
    stylistExternalId: appointment.stylist.treatwellExternalId,
    serviceExternalId: appointment.service.treatwellExternalId,
  });

  try {
    await runSerializableWithRetry(async (tx) => {
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, userId: session.userId, status: appointment.status, date: appointment.date, updatedAt: appointment.updatedAt },
        data: { status: 'CANCELLED', treatwellSyncStatus, treatwellSyncError: null, notificationVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new BookingError('STALE');
      const cancelled = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { user: true, stylist: true, service: true } });
      if (!cancelled) throw new BookingError('APPOINTMENT_NOT_FOUND');
      await enqueueAppointmentNotification(tx, 'CANCELLATION', cancelled);
    });
    invalidateStylistIcalFeed();
    after(() => dispatchAppointmentNotifications(appointmentId));
  } catch (error) {
    return { success: false, error: describeBookingError(error, locale, 'CANCEL_FAILED') };
  }

  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/book');
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
  const locale = await getActionLocale();
  if (!(await isBookingEnabled())) {
    return failure(locale, 'MAINTENANCE');
  }

  const session = await verifySession();

  // Reject malformed date/time before any DB work (no Zod schema on this path).
  if (!isValidSalonDate(dateStr) || !isValidSalonTime(time)) {
    return failure(locale, 'INVALID_DATE_TIME');
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
    return failure(locale, 'APPOINTMENT_NOT_FOUND');
  }

  if (appointment.status !== 'CONFIRMED') {
    return failure(locale, 'RESCHEDULE_ONLY_CONFIRMED');
  }

  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < 24) {
    return failure(locale, 'RESCHEDULE_TOO_LATE');
  }

  // Resolve the new salon wall-clock time to the correct absolute UTC instant
  // (handles BST/GMT) — the create path did this but reschedule previously did not.
  const salon = resolveSalonDateTime(dateStr, time);
  const newDate = salon.utc;

  // Defensive: reject an unparseable instant before it reaches the DB.
  if (Number.isNaN(newDate.getTime())) {
    return failure(locale, 'INVALID_DATE_TIME');
  }

  // Prevent rescheduling into the past
  if (newDate <= new Date()) {
    return failure(locale, 'RESCHEDULE_PAST');
  }

  // Moving a booking to the time it already has changes nothing, so it must
  // not bump the notification version: each bump is a separate email to the
  // customer and the salon, and resubmitting the same time was a way to send
  // as many as anyone liked.
  if (newDate.getTime() === appointment.date.getTime()) {
    return { success: true };
  }

  // Real moves also email both sides. Checked only after ownership, so nobody
  // can spend another customer's allowance.
  if (!(await rescheduleLimiter.check(`user:${session.userId}`)) ||
      !(await appointmentRescheduleLimiter.check(`appt:${appointmentId}`))) {
    return failure(locale, 'TOO_MANY_RESCHEDULES');
  }

  // Validate the new time falls within stylist availability for this day
  const duration = appointment.durationAtBooking ?? appointment.service.duration;
  const hoursCheck = await checkStylistHours(appointment.stylistId, salon, duration);
  if (!hoursCheck.ok) {
    return failure(locale, hoursCheck.code);
  }

  // Re-validate the colour patch-test gate against the NEW date.
  if (appointment.service.requiresPatchTest) {
    const eligibility = await getValidPatchTest(session.userId, newDate);
    if (!eligibility.ok) {
      return failure(locale,
        eligibility.reason === 'too_soon'
          ? 'PATCH_TEST_TOO_SOON'
          : eligibility.reason === 'expired'
            ? 'PATCH_TEST_EXPIRED'
            : 'PATCH_TEST_REQUIRED');
    }
  }

  try {
    const oldDate = appointment.date;

    const updated = await runSerializableWithRetry(async (tx) => {
      await assertOnlineBookingReady(tx);
      await assertAppointmentSlotAvailable(tx, appointment, newDate);

      const treatwellApi = getTreatwellApiConfiguration();
      const treatwellSyncStatus = changedTreatwellSyncStatus({
        apiReady: treatwellApi.enabled && treatwellApi.configured,
        treatwellBookingId: appointment.treatwellBookingId,
        stylistExternalId: appointment.stylist.treatwellExternalId,
        serviceExternalId: appointment.service.treatwellExternalId,
      });

      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, userId: session.userId, status: 'CONFIRMED', date: appointment.date, updatedAt: appointment.updatedAt },
        data: { date: newDate, reminderSent: false, treatwellSyncStatus, treatwellSyncError: null, notificationVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new BookingError('STALE');
      const rescheduled = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          user: { select: { email: true, name: true } },
          stylist: { select: { name: true, treatwellExternalId: true } },
          service: true,
        },
      });
      if (!rescheduled) throw new BookingError('APPOINTMENT_NOT_FOUND');
      await enqueueAppointmentNotification(tx, 'RESCHEDULE', rescheduled, { oldDate });
      return rescheduled;
    });

    invalidateStylistIcalFeed();
    after(() => dispatchAppointmentNotifications(updated.id));
    revalidateAllLocales(revalidatePath, '/appointments');
    revalidateAllLocales(revalidatePath, '/admin');
    revalidateAllLocales(revalidatePath, '/book');
    return { success: true };
  } catch (error) {
    console.error('Reschedule failed:', error);
    return { success: false, error: describeBookingError(error, locale, 'RESCHEDULE_FAILED') };
  }
}
