'use server';

import { createBooking, createBookingForFirstAvailable, findExistingRequest, getAvailableSlots, getAvailableSlotsUnion, getBookingDays, getValidPatchTest, precheckBookingRequest, runSerializableWithRetry, assertAppointmentSlotAvailable, type BookingDeposit } from '@/app/services/booking-service';
import type { BookingDay } from '@/app/services/booking-days';
import { revalidatePath } from 'next/cache';
import { EMAIL_VERIFICATION_SELECT, hasVerifiedEmail } from '@/app/lib/email-verification';
import { evaluateBookingGates, type PatchTestGateReason } from '@/app/services/booking-gates';
import { resolveSalonDateTime, fitsWithinAvailability, isValidSalonTime, isValidSalonDate, SALON_TIME_RE, SALON_DATE_RE, type SalonDateTime } from '@/app/services/salon-time';
import { BookingError, bookingErrorText, describeBookingError, type BookingErrorCode } from '@/app/services/booking-errors';
import { describeFault } from '@/app/lib/fault';
import { PriceChangedError } from '@/app/services/booking-service';
import { getActionLocale } from '@/i18n/request';
import type { Locale } from '@/i18n/config';
import type { PriceQuote } from '@/app/services/pricing/quote';
import { ANY_STYLIST_ID, BOOKING_DAYS_MAX, MIN_BOOKING_NOTICE_MINUTES, ONLINE_CANCEL_NOTICE_HOURS } from '@/app/lib/booking-constants';
import type { MessageParams } from '@/i18n/format';
import { enqueueAppointmentNotification, dispatchAppointmentNotifications } from '@/app/services/notification-outbox-service';
import { verifySession } from '@/app/lib/session';
import { appendAuditEvent } from '@/app/lib/audit';
import { isRescheduleRequestExpired } from '@/app/lib/reschedule-request';
import { after } from 'next/server';
import { invalidateStylistIcalFeed } from '@/app/services/stylist-ical-cache';
import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import {
  appointmentRescheduleLimiter, availabilityLimiter, bookingDailyLimiter, bookingLimiter, cancelLimiter, depositAuthorizeIpLimiter, depositDeclineAccountLimiter, depositDeclineIpLimiter, rescheduleLimiter,
} from '@/app/lib/rate-limit';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from '@/app/services/treatwell-api';
import { isBookingEnabled, assertOnlineBookingReady } from '@/app/lib/booking-maintenance';
import { isBookableDateWindow } from '@/app/services/booking-horizon';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { headers } from 'next/headers';
import { quoteDepositForNewBooking } from '@/app/services/deposit-quote';
import { quoteMatches } from '@/app/services/pricing/quote';
import { usableSquareConfig } from '@/app/lib/online-booking-lock';
import { createSquareGateway } from '@/app/services/square-gateway';
import { createPaymentAttemptService, depositPaymentNote, depositRequestJson, replayAnswer, type DepositAttempt } from '@/app/services/payment-attempts';
import { OPERATIONS_MESSAGES } from '@/app/services/operations-messages';
import { planDepositForClosing, settleDepositAfterCommit, settleDepositBeforeClosing } from '@/app/services/deposit-lifecycle';

// bookingLimiter curbs calendar-blockade abuse. It comes from lib/rate-limit.ts,
// which falls back to in-process limiting when Upstash is unconfigured. (The
// discount-code limiter went with the codes themselves: while discounts are
// paused no code is ever looked up, so there is nothing to enumerate.)

/** A failed action result in the caller's language. */
function failure(locale: Locale, code: BookingErrorCode, params?: MessageParams) {
  return { success: false as const, code, error: bookingErrorText(locale, code, params) };
}

/** The client's address, as Vercel reports it (the first x-forwarded-for entry). */
async function clientAddress(): Promise<string> {
  return (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// The availability lookups need no session, so they are limited per address.
async function availabilityAllowed(): Promise<boolean> {
  return availabilityLimiter.check(await clientAddress());
}

/**
 * Whether the signed-in customer has proved their address. Booking needs it,
 * and so does seeing or changing a booking: staff attach phone bookings to the
 * account that holds the customer's email, and anyone can register an address
 * they do not own (security review 2026-10-16).
 */
async function hasProvedEmail(userId: string): Promise<boolean> {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: EMAIL_VERIFICATION_SELECT });
  return Boolean(account && hasVerifiedEmail(account));
}

/** The decline budgets' keys for this customer and address (rate-limit.ts DEPOSIT_DECLINE_*). */
const declineKeys = (userId: string, ip: string) => ({ account: `user:${userId}`, address: `ip:${ip}` });

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
  /**
   * The card deposit the page showed and tokenized for, in pence. The server
   * works the deposit out again and refuses (QUOTE_CHANGED) on any difference.
   */
  expectedDepositPence?: number;
  /** Square's single-use card token for the deposit — never card details. */
  paymentToken?: string;
  /**
   * The page's key for this one card tokenization (a UUID v4, new for every
   * tokenization). Sent again with the same token only to retry a request
   * whose answer was lost: the stored outcome is returned, never a second hold.
   */
  attemptKey?: string;
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
  expectedDepositPence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  paymentToken: z.string().min(1).max(2048).regex(/^\S+$/).optional(),
  // One spelling per key, so the same submission always finds its attempt.
  attemptKey: z.uuidv4().transform((key) => key.toLowerCase()).optional(),
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

/**
 * A failed availability lookup. `reason: 'CLOSED'` means online booking is
 * closed (the nightly pause, or staff switched it off), which the page must
 * say as such — not as "no appointments available", and not as "couldn't
 * load" (a lookup failure, with no reason).
 */
type AvailabilityRefused = { ok: false; reason?: 'CLOSED' };

// Helper for client-side fetching without form state. The "Anyone" option
// returns the union of every stylist's availability.
export type FetchSlotsResult =
  | { ok: true; slots: Awaited<ReturnType<typeof getAvailableSlots>> }
  | AvailabilityRefused;

export async function fetchSlots(
  stylistId: string,
  date: string,
  serviceDuration: number,
): Promise<FetchSlotsResult> {
  if (!(await isBookingEnabled())) {
    return { ok: false, reason: 'CLOSED' };
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

export type FetchBookingDaysResult = { ok: true; days: BookingDay[] } | AvailabilityRefused;

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
    return { ok: false, reason: 'CLOSED' };
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

/** A booking's price split: the card deposit now, the rest in the salon (see actions/booking-quote.ts). */
export type DepositSplit = { amountPence: number; depositPence: number; remainderPence: number };

export type SubmitBookingResult =
  /**
   * `alreadyRequested`: the same request was already made (see findRepeatRequest); nothing new was booked.
   * `depositHeldPence`: the hold Square has on the card for this request, when this submission knows of one.
   */
  | { success: true; alreadyRequested?: true; depositHeldPence?: number }
  /** `quote`: the current price (PRICE_CHANGED). `deposit`: the current deposit (QUOTE_CHANGED). */
  | { success: false; code?: BookingErrorCode; error: string; quote?: ClientQuote; deposit?: DepositSplit };

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

  // A request holds a real slot and emails the address on the account, and
  // registering needs no mailbox: without this, throwaway accounts could each
  // hold their full allowance of slots. See lib/email-verification.ts.
  const account = await prisma.user.findUnique({ where: { id: session.userId }, select: { ...EMAIL_VERIFICATION_SELECT, preferredLocale: true } });
  if (!account || !hasVerifiedEmail(account)) {
    return failure(locale, 'EMAIL_NOT_VERIFIED');
  }

  // Per-user rate limit. Degrades to in-process limiting on a Redis outage or
  // missing config, rather than failing open.
  if (!(await bookingLimiter.check(`user:${session.userId}`)) || !(await bookingDailyLimiter.check(`user:${session.userId}`))) {
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
    // Online requests only: staff approve them, so they need notice. Bookings
    // staff enter themselves (admin-schedule.ts) never pass through here.
    minNoticeMinutes: MIN_BOOKING_NOTICE_MINUTES,
  });
  if (!gate.ok) {
    return failure(locale, gate.code, gate.params);
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

  // The deposit is worked out here, from current data (the SiteSettings row,
  // the service's own override, the server quote) — never an amount the page
  // sends. Staff-entered bookings never come through here and never take one.
  let priced: Awaited<ReturnType<typeof quoteDepositForNewBooking>>;
  try {
    priced = await quoteDepositForNewBooking(prisma, validData.serviceId);
  } catch (error) {
    // Unknown, retired or inconsistently priced services are ordinary
    // refusals; anything else (database, an impossible deposit policy) is a fault.
    if (!(error instanceof BookingError)) console.error('Working out the booking deposit failed', { serviceId: validData.serviceId, ...describeFault(error) });
    return { success: false, code: error instanceof BookingError ? error.code : 'BOOKING_FAILED', error: describeBookingError(error, locale, 'BOOKING_FAILED') };
  }

  // The discount code is validated + claimed INSIDE the booking transaction
  // (see booking-service), so a failed booking never burns a code's usedCount.
  // No CONFIRMATION email is sent here: the booking is only a PENDING request
  // at this point. The confirmation email goes out when an admin approves it —
  // see updateAppointmentStatus in actions/admin.ts. What is sent after it is
  // the customer's "we got your request" acknowledgement plus the salon's alert.
  const request = {
    serviceId: validData.serviceId,
    date: fullDate,
    userId: session.userId,
    notes,
    // Without an expectation the page never showed a server price (an old
    // tab): force a fresh confirmation rather than guess.
    expectedQuote: validData.expectedQuote ?? null,
    locale,
  };
  const book = (deposit?: BookingDeposit) => isAnyStylist
    ? createBookingForFirstAvailable({ ...request, candidateStylistIds, deposit })
    : createBooking({ ...request, stylistId: validData.stylistId, deposit });
  const announce = (appointmentId: string) => announceBooking(appointmentId, { userId: session.userId, savedLocale: account.preferredLocale, locale });
  // findRepeatRequest's rule before the transaction: the named stylist's
  // request, or any stylist's for "Anyone".
  const findRepeat = () => findExistingRequest(request, isAnyStylist ? undefined : validData.stylistId);

  if (priced.deposit.depositPence > 0) {
    return submitWithDeposit({
      locale, userId: session.userId, input: validData, request, priced, book, announce, findRepeat,
      precheck: () => precheckBookingRequest(isAnyStylist ? { ...request, candidateStylistIds } : { ...request, stylistId: validData.stylistId }),
    });
  }

  // No deposit: the request books exactly as it always has; payment fields are ignored.
  try {
    const appointment = await book();
    // The same request again (the answer to the first was lost, or a second
    // tap): see answerRepeat.
    if (appointment.repeat) return answerRepeat(appointment.id);
    announce(appointment.id);
    return { success: true };
  } catch (error) {
    return bookingFailure(error, locale);
  }
}

/**
 * The same request again (the answer to the first was lost, or a second tap):
 * nothing new is booked or queued, and the wizard tells the customer it was
 * already requested. The first attempt's commit can succeed and its answer
 * still be lost, so its announcement may never have run: refresh the busy
 * feed and deliver whatever is still queued for this booking now, or the feed
 * waits for its one-day safety net and the emails for the next cron tick.
 * Both are idempotent (an extra feed rebuild; sent mail is not sent again).
 * A repeat never authorizes a card; `depositHeldPence` is only ever the hold
 * this same submission placed (a replay of its own attempt key).
 */
function answerRepeat(appointmentId: string, extra: { depositHeldPence?: number } = {}): SubmitBookingResult {
  invalidateStylistIcalFeed();
  after(() => dispatchAppointmentNotifications(appointmentId));
  return { success: true, alreadyRequested: true, ...extra };
}

/** A booking the transaction refused (or failed), as the customer's answer. */
function bookingFailure(error: unknown, locale: Locale): SubmitBookingResult {
  if (error instanceof PriceChangedError) {
    return { success: false, code: 'PRICE_CHANGED', error: error.localized(locale), quote: toClientQuote(error.quote) };
  }
  console.error('Booking failed:', error);
  // Only surface customer-safe messages (slot taken, price changed);
  // anything else (Prisma/internal) becomes a generic message.
  return { success: false, code: error instanceof BookingError ? error.code : 'BOOKING_FAILED', error: describeBookingError(error, locale, 'BOOKING_FAILED') };
}

/** What a new request triggers once it is committed. A repeat runs only the part answerRepeat says. */
function announceBooking(appointmentId: string, customer: { userId: string; savedLocale: string | null; locale: Locale }) {
  // The marketplaces poll a cached feed; drop it so the new busy period is
  // visible on their next poll rather than whenever the window expires.
  invalidateStylistIcalFeed();
  // Next flushes cache invalidation when the action finishes. Keep delivery
  // after the response so slow email cannot hold the busy feed stale.
  after(async () => {
    await dispatchAppointmentNotifications(appointmentId);
    // Remember the language for mail the salon later sends on the customer's
    // behalf (e.g. a booking an administrator enters for them) — only when it
    // changed. Best effort and after the response: the booking already records
    // its own language, so this can never turn a made booking into an error.
    if (customer.savedLocale !== customer.locale) {
      try {
        await prisma.user.update({ where: { id: customer.userId }, data: { preferredLocale: customer.locale } });
      } catch {
        // Preference only.
      }
    }
  });
  revalidateAllLocales(revalidatePath, '/book');
  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/admin');
}

type BookedRequest = { id: string; repeat: boolean };

/**
 * After a booking transaction failed unclearly: the appointment its deposit
 * attempt was tied to — set only inside a booking transaction that committed
 * — or null when it was not tied (nothing booked). Undefined when the
 * database cannot say.
 */
async function bookedWithAttempt(attemptId: string): Promise<string | null | undefined> {
  try {
    const attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId }, select: { appointmentId: true } });
    return attempt?.appointmentId ?? null;
  } catch {
    return undefined;
  }
}

/**
 * A request that owes a card deposit (docs/superpowers/specs/2026-10-13-square-deposits-design.md,
 * "Submit"). Square HOLDS the deposit (it is taken only when staff approve);
 * the appointment and the hold are tied together in the booking transaction.
 * Every refusal that can be known in advance is made before money moves, and
 * a hold whose booking is not made is released straight away.
 */
async function submitWithDeposit(context: {
  locale: Locale;
  userId: string;
  input: z.infer<typeof createBookingSchema>;
  request: { serviceId: string; date: Date; userId: string; expectedQuote: { serviceId: string; priceVersion: number; amountPence: number } | null };
  priced: Awaited<ReturnType<typeof quoteDepositForNewBooking>>;
  book: (deposit?: BookingDeposit) => Promise<BookedRequest>;
  announce: (appointmentId: string) => void;
  /** The request already made, by findRepeatRequest's rule (findExistingRequest). */
  findRepeat: () => Promise<{ id: string } | null>;
  precheck: () => Promise<void>;
}): Promise<SubmitBookingResult> {
  const { locale, userId, input, request, priced } = context;
  const { quote, deposit } = priced;

  // No usable Square configuration (switched off, incomplete, or sandbox
  // credentials in a production build): refuse rather than book without the
  // deposit. Read now, never at module load; it carries the access token.
  const config = usableSquareConfig();
  if (!config) return failure(locale, 'PAYMENT_UNAVAILABLE');

  // The price the page showed, before any money moves (the transaction checks
  // again). Answered first: a new price usually means a new deposit too, and
  // the page re-reads the deposit along with the new price.
  if (!quoteMatches(quote, request.expectedQuote)) return bookingFailure(new PriceChangedError(quote), locale);

  // The page tokenized the card for exactly this amount (3-D Secure shows it
  // to the customer): any difference means they must review it again.
  if (input.expectedDepositPence !== deposit.depositPence) {
    return { ...failure(locale, 'QUOTE_CHANGED'), deposit: { amountPence: quote.amountPence, depositPence: deposit.depositPence, remainderPence: deposit.remainderPence } };
  }
  const { attemptKey, paymentToken } = input;
  if (!attemptKey || !paymentToken) return failure(locale, 'PAYMENT_REQUIRED');

  const payments = createPaymentAttemptService({ db: prisma, gateway: createSquareGateway({ loadConfig: async () => config }) });
  const fingerprint = { serviceId: request.serviceId, stylist: input.stylistId, start: request.date.toISOString() };

  // The same submission again (its answer was lost): the outcome the first
  // one reached, never a second authorization.
  const replay = async (previous: DepositAttempt): Promise<SubmitBookingResult> => {
    // A key belongs to one request: never answer for a different one with it.
    if (previous.requestJson !== depositRequestJson(fingerprint)) return failure(locale, 'INVALID_BOOKING');
    const answer = replayAnswer(previous);
    // BOOKED: the attempt is linked to its appointment (replayAnswer). The
    // hold it reports is this submission's own.
    if (answer === 'BOOKED') return answerRepeat(previous.appointmentId!, previous.status === 'AUTHORIZED' ? { depositHeldPence: previous.amountPence } : {});
    // Booked after all — by another card attempt, or before deposits applied.
    const made = await context.findRepeat();
    if (made) return answerRepeat(made.id);
    return failure(locale, answer);
  };
  const previous = await payments.find(userId, attemptKey);
  if (previous) return replay(previous);

  // The same request already made (a second tap with a fresh card token):
  // answered as made, and nothing is charged again.
  const existing = await context.findRepeat();
  if (existing) return answerRepeat(existing.id);

  // Everything the booking transaction would refuse — booking closed, the
  // upcoming-booking cap, a taken time — is refused before any money moves.
  try {
    await context.precheck();
  } catch (error) {
    return bookingFailure(error, locale);
  }

  // Card testing: an account (3) or an address (5) whose cards Square has
  // declined that often in the last day gets no more card attempts here —
  // refused before an attempt is written or Square is asked.
  const declines = declineKeys(userId, await clientAddress());
  const [accountAllowed, addressAllowed] = await Promise.all([
    depositDeclineAccountLimiter.allows(declines.account), depositDeclineIpLimiter.allows(declines.address),
  ]);
  if (!accountAllowed || !addressAllowed) return failure(locale, 'PAYMENT_UNAVAILABLE');
  // The declines above are counted only once Square answers; this budget is
  // spent now, atomically, so simultaneous submissions cannot all slip past.
  if (!(await depositAuthorizeIpLimiter.check(declines.address))) return failure(locale, 'PAYMENT_UNAVAILABLE');

  const attempt = await payments.create({
    userId,
    attemptKey,
    amountPence: deposit.depositPence,
    quoteAmountPence: quote.amountPence,
    policy: deposit.policy,
    request: fingerprint,
    config,
  });
  if (!attempt) {
    // A concurrent copy of this submission created it first: answer as it does.
    const concurrent = await payments.find(userId, attemptKey);
    return concurrent ? replay(concurrent) : failure(locale, 'INVALID_BOOKING');
  }

  const authorized = await payments.authorize(attempt, {
    sourceId: paymentToken,
    note: depositPaymentNote(priced.service.name, input.date, input.time),
  });
  if (authorized.outcome === 'DECLINED') {
    // Square refused the card (HTTP 400/402): it counts against both budgets.
    await Promise.all([depositDeclineAccountLimiter.record(declines.account), depositDeclineIpLimiter.record(declines.address)]);
    return failure(locale, 'CARD_DECLINED');
  }
  // Never sent, or refused by this website's own Square setup (401/403/404…):
  // not the customer's card, so no decline is counted against them.
  if (authorized.outcome === 'UNAVAILABLE' || authorized.outcome === 'SETUP_REFUSED') return failure(locale, 'PAYMENT_UNAVAILABLE');
  if (authorized.outcome === 'UNCERTAIN') return failure(locale, 'PAYMENT_UNCERTAIN');
  const hold = authorized.attempt;

  let appointment: BookedRequest;
  try {
    appointment = await context.book({ attemptId: hold.id, amountPence: hold.amountPence });
  } catch (error) {
    // A refusal (BookingError: the time went in between, booking closed, …)
    // rolled the booking back. Anything else — a dropped connection, say —
    // may have come after the COMMIT, its answer lost on the way back: the
    // attempt is tied to an appointment only by a booking that committed.
    if (!(error instanceof BookingError)) {
      const linked = await bookedWithAttempt(hold.id);
      if (linked === undefined) {
        // Cannot tell. Releasing could strip the hold from a live request;
        // calling it failed could deny a booking that exists. The customer is
        // asked to look in My Bookings; an unbooked hold is released by
        // reconciliation, and Square drops it when it runs out anyway.
        console.error('Booking with a deposit hold failed unclearly', { attemptId: hold.id, ...describeFault(error) });
        return failure(locale, 'PAYMENT_PENDING');
      }
      if (linked) {
        // It committed: booked, with its hold, exactly as if the answer had arrived.
        context.announce(linked);
        return { success: true, depositHeldPence: hold.amountPence };
      }
    }
    // Nothing was booked: release the hold now rather than leave it on the card for days.
    await payments.release(hold, OPERATIONS_MESSAGES.PAYMENT_RELEASED_NOT_BOOKED);
    return bookingFailure(error, locale);
  }
  if (appointment.repeat) {
    // A concurrent copy of the same request was booked first: that booking
    // stands as it was made, and this second hold is released.
    await payments.release(hold, OPERATIONS_MESSAGES.PAYMENT_RELEASED_REPEAT);
    return answerRepeat(appointment.id);
  }
  context.announce(appointment.id);
  return { success: true, depositHeldPence: hold.amountPence };
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
  if (!(await hasProvedEmail(session.userId))) return failure(locale, 'MANAGE_EMAIL_NOT_VERIFIED');

  if (appointment.status !== 'CONFIRMED' && appointment.status !== 'PENDING') {
    return failure(locale, 'CANCEL_ONLY_ACTIVE');
  }

  // The 24-hour rule only protects slots the salon has actually confirmed; a
  // customer may withdraw a still-PENDING request at any time.
  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (appointment.status === 'CONFIRMED' && hoursUntil < ONLINE_CANCEL_NOTICE_HOURS) {
    return failure(locale, 'CANCEL_TOO_LATE');
  }
  // Every withdrawal emails the customer and frees the slot (bookingDailyLimiter).
  if (!(await cancelLimiter.check(`user:${session.userId}`))) return failure(locale, 'TOO_MANY_CANCELLATIONS');

  const treatwellApi = getTreatwellApiConfiguration();
  const treatwellSyncStatus = changedTreatwellSyncStatus({
    apiReady: treatwellApi.enabled && treatwellApi.configured,
    treatwellBookingId: appointment.treatwellBookingId,
    stylistExternalId: appointment.stylist.treatwellExternalId,
    serviceExternalId: appointment.service.treatwellExternalId,
  });

  try {
    const now = new Date();
    // A capture nobody saw finish is settled first (Square is asked), so the
    // cancellation knows whether the deposit was taken or is still only held;
    // while staff are taking it, the customer is asked to try again shortly.
    const refusal = await settleDepositBeforeClosing(prisma, appointmentId, now);
    if (refusal) throw new BookingError(refusal);
    const deposit = await runSerializableWithRetry(async (tx) => {
      // The card deposit (docs/superpowers/specs/2026-10-13-square-deposits-design.md):
      // a withdrawn request's hold is released; a confirmed booking cancelled
      // online (24 hours or more ahead, checked above) is refunded in full.
      const plan = await planDepositForClosing(tx, appointmentId, { closing: 'CANCEL', refund: true, reason: 'CUSTOMER_CANCELLED', requestedById: null, now });
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, userId: session.userId, status: appointment.status, date: appointment.date, updatedAt: appointment.updatedAt },
        data: { status: 'CANCELLED', rescheduleRequestedDate: null, rescheduleRequestedAt: null, treatwellSyncStatus, treatwellSyncError: null, notificationVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new BookingError('STALE');
      const cancelled = await tx.appointment.findUnique({ where: { id: appointmentId }, include: { user: true, stylist: true, service: true } });
      if (!cancelled) throw new BookingError('APPOINTMENT_NOT_FOUND');
      // A withdrawn request was never in the customer's calendar: no file to remove it.
      await enqueueAppointmentNotification(tx, 'CANCELLATION', { ...cancelled, paymentAttempt: plan.paymentAttempt }, {
        wasConfirmed: appointment.status === 'CONFIRMED',
        ...(plan.outcome ? { depositOutcome: plan.outcome } : {}),
      });
      return plan;
    });
    invalidateStylistIcalFeed();
    // Release the hold or ask Square for the refund, now that it is committed.
    await settleDepositAfterCommit(prisma, deposit);
    after(() => dispatchAppointmentNotifications(appointmentId));
  } catch (error) {
    // A refusal (stale, not found) is an answer; anything else is a fault to investigate.
    if (!(error instanceof BookingError)) console.error('Cancelling an appointment failed:', { appointmentId, ...describeFault(error) });
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

const requestInclude = {
  user: { select: { email: true, name: true, phone: true } },
  stylist: { select: { name: true } },
  service: true,
} as const;

/**
 * A customer asks to move a CONFIRMED booking. Nothing moves: the original time
 * stays booked until staff approve (admin.ts decideRescheduleRequest), and the
 * requested time is checked now but not held. One open request per booking; a
 * new time replaces it.
 */
export async function requestReschedule(appointmentId: string, dateStr: string, time: string) {
  const locale = await getActionLocale();
  // A request books nothing yet, but it is still online booking: closed with it.
  if (!(await isBookingEnabled())) return failure(locale, 'MAINTENANCE');

  const session = await verifySession();
  if (!isValidSalonDate(dateStr) || !isValidSalonTime(time)) return failure(locale, 'INVALID_DATE_TIME');

  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: requestInclude });
  if (!appointment || appointment.userId !== session.userId) return failure(locale, 'APPOINTMENT_NOT_FOUND');
  if (!(await hasProvedEmail(session.userId))) return failure(locale, 'MANAGE_EMAIL_NOT_VERIFIED');
  if (appointment.status !== 'CONFIRMED') return failure(locale, 'RESCHEDULE_ONLY_CONFIRMED');
  if ((appointment.date.getTime() - Date.now()) / 3_600_000 < 24) return failure(locale, 'RESCHEDULE_TOO_LATE');

  const salon = resolveSalonDateTime(dateStr, time);
  const newDate = salon.utc;
  if (Number.isNaN(newDate.getTime())) return failure(locale, 'INVALID_DATE_TIME');
  if (newDate <= new Date()) return failure(locale, 'RESCHEDULE_PAST');
  // It would lapse at once: staff could never approve it.
  if (isRescheduleRequestExpired(newDate)) return failure(locale, 'RESCHEDULE_REQUEST_TOO_SOON');

  // Asking for the time it already has, or the time already asked for, changes
  // nothing and sends nothing (each real request emails the customer and the salon).
  if (newDate.getTime() === appointment.date.getTime() || newDate.getTime() === appointment.rescheduleRequestedDate?.getTime()) {
    return { success: true as const };
  }

  const duration = appointment.durationAtBooking ?? appointment.service.duration;
  const hoursCheck = await checkStylistHours(appointment.stylistId, salon, duration);
  if (!hoursCheck.ok) return failure(locale, hoursCheck.code);

  if (appointment.service.requiresPatchTest) {
    const eligibility = await getValidPatchTest(session.userId, newDate);
    if (!eligibility.ok) {
      return failure(locale,
        eligibility.reason === 'too_soon' ? 'PATCH_TEST_TOO_SOON'
          : eligibility.reason === 'expired' ? 'PATCH_TEST_EXPIRED' : 'PATCH_TEST_REQUIRED');
    }
  }

  // Each request emails the customer and the salon, so requests are limited.
  // Checked after ownership and every refusal above, so refused times spend no allowance.
  if (!(await rescheduleLimiter.check(`user:${session.userId}`)) ||
      !(await appointmentRescheduleLimiter.check(`appt:${appointmentId}`))) {
    return failure(locale, 'TOO_MANY_RESCHEDULES');
  }

  try {
    const requestedAt = new Date();
    await runSerializableWithRetry(async (tx) => {
      await assertOnlineBookingReady(tx);
      // Refuse a time that is already taken; it is not held after this.
      await assertAppointmentSlotAvailable(tx, appointment, newDate);
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, userId: session.userId, status: 'CONFIRMED', date: appointment.date, updatedAt: appointment.updatedAt, rescheduleRequestedAt: appointment.rescheduleRequestedAt },
        data: { rescheduleRequestedDate: newDate, rescheduleRequestedAt: requestedAt },
      });
      if (changed.count !== 1) throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
      await enqueueAppointmentNotification(tx, 'RESCHEDULE_REQUEST_RECEIVED', appointment, { requestedDate: newDate, requestedAt });
      await enqueueAppointmentNotification(tx, 'SALON_RESCHEDULE_ALERT', appointment, { requestedDate: newDate, requestedAt });
      await appendAuditEvent({
        actorUserId: session.userId,
        action: appointment.rescheduleRequestedAt ? 'APPOINTMENT.RESCHEDULE_REPLACED' : 'APPOINTMENT.RESCHEDULE_REQUESTED',
        targetType: 'Appointment', targetId: appointmentId,
        metadata: { from: appointment.date.toISOString(), to: newDate.toISOString(), requestedAt: requestedAt.toISOString() },
      }, tx);
    });
    after(() => dispatchAppointmentNotifications(appointmentId));
    revalidateAllLocales(revalidatePath, '/appointments');
    revalidateAllLocales(revalidatePath, '/admin');
    return { success: true as const };
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Reschedule request failed:', error);
    return { success: false as const, code: error instanceof BookingError ? error.code : undefined, error: describeBookingError(error, locale, 'RESCHEDULE_FAILED') };
  }
}

/** The customer takes back an open request. No email; allowed while booking is closed. */
export async function withdrawRescheduleRequest(appointmentId: string) {
  const locale = await getActionLocale();
  const session = await verifySession();
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, userId: true, status: true, date: true, rescheduleRequestedDate: true, rescheduleRequestedAt: true },
  });
  if (!appointment || appointment.userId !== session.userId) return failure(locale, 'APPOINTMENT_NOT_FOUND');
  if (!(await hasProvedEmail(session.userId))) return failure(locale, 'MANAGE_EMAIL_NOT_VERIFIED');
  if (!appointment.rescheduleRequestedAt) return failure(locale, 'RESCHEDULE_REQUEST_CHANGED');
  const withdrawn = {
    from: appointment.date.toISOString(),
    to: appointment.rescheduleRequestedDate?.toISOString() ?? null,
    requestedAt: appointment.rescheduleRequestedAt.toISOString(),
  };
  try {
    await runSerializableWithRetry(async (tx) => {
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, userId: session.userId, status: appointment.status, date: appointment.date, rescheduleRequestedAt: appointment.rescheduleRequestedAt },
        data: { rescheduleRequestedDate: null, rescheduleRequestedAt: null },
      });
      if (changed.count !== 1) throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
      await appendAuditEvent({ actorUserId: session.userId, action: 'APPOINTMENT.RESCHEDULE_WITHDRAWN', targetType: 'Appointment', targetId: appointmentId, metadata: withdrawn }, tx);
    });
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Withdrawing a reschedule request failed:', error);
    return { success: false as const, code: error instanceof BookingError ? error.code : undefined, error: describeBookingError(error, locale, 'RESCHEDULE_FAILED') };
  }
  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/admin');
  return { success: true as const };
}
