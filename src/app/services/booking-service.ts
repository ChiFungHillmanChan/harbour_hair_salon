import { assertOnlineBookingReady } from '@/app/lib/booking-maintenance';
import { enqueueAppointmentNotification } from './notification-outbox-service';
import prisma from '@/app/lib/prisma';
import { Prisma, type Appointment, type Service } from '@prisma/client';
import {
  evaluatePatchTestEligibility,
  type EligibilityResult,
} from './patch-test-eligibility';
import { salonDayWindow, toSalonDateStr, resolveSalonDateTime, salonDateKey, formatSalonTime, fitsWithinAvailability } from './salon-time';
import { firstFreeStylist, hasConflict, buildSlotsForWindow, type BookedInterval, type TimeSlot } from './scheduling';
import { loadExternalBusy, toBookedInterval, toSlotAppointment } from './external-busy';
import { BookingError, SlotUnavailableError, DiscountUnavailableError } from './booking-errors';
import { quoteForNewBooking } from './pricing/quote-service';
import { quoteMatches, serializeQuote, type PriceQuote, type QuoteExpectation } from './pricing/quote';
import { penceToDecimalString } from './pricing/money';
import type { Locale } from '@/i18n/config';
import { bookingCoverageEndsAt, isWithinBookingHorizon } from './booking-horizon';
import { buildBookingDays, type BookingDay, type WorkingHours } from './booking-days';
import { ANY_STYLIST_ID } from '@/app/lib/booking-constants';
import { getTreatwellApiConfiguration, initialTreatwellSyncStatus } from './treatwell-api';

/**
 * Run a Serializable transaction, retrying a few times on Postgres serialization
 * failures (Prisma P2034). Under Serializable isolation, two concurrent bookings
 * that read the same day-window can trip a write-conflict even when their slots
 * don't actually overlap — a transparent retry then succeeds instead of showing
 * the customer a spurious "Failed to create booking".
 */
export async function runSerializableWithRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034' &&
        attempt < maxAttempts
      ) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export type { TimeSlot } from './scheduling';

const slotAppointmentSelect = {
  stylistId: true, date: true, durationAtBooking: true,
  service: { select: { duration: true } },
} satisfies Prisma.AppointmentSelect;

async function assertActiveBookingLimit(tx: Prisma.TransactionClient, userId: string) {
  // The predicate must be read in the Serializable transaction that inserts the
  // booking. Concurrent inserts for this user then conflict and retry the count.
  const count = await tx.appointment.count({
    where: { userId, status: { in: ['PENDING', 'CONFIRMED'] }, date: { gt: new Date() } },
  });
  if (count >= 6) throw new BookingError('MAX_UPCOMING');
}

/** Recheck the full reserved duration and current calendar inside a mutation. */
export async function assertAppointmentSlotAvailable(
  tx: Prisma.TransactionClient,
  appointment: Pick<Appointment, 'id' | 'stylistId' | 'durationAtBooking'> & { service: Pick<Service, 'duration'> },
  date: Date,
  loadedBlocking?: BookedInterval[],
) {
  const duration = appointment.durationAtBooking ?? appointment.service.duration;
  if (!isWithinBookingHorizon(date, duration)) {
    throw new BookingError('OUTSIDE_HORIZON');
  }
  const salon = resolveSalonDateTime(salonDateKey(date), formatSalonTime(date));
  const availability = await tx.availability.findFirst({
    where: { stylistId: appointment.stylistId, dayOfWeek: salon.dayOfWeek, isOff: false, stylist: { isActive: true } },
    select: { startTime: true, endTime: true },
  });
  if (!availability) throw new BookingError('STYLIST_OFF_THAT_DAY');
  if (!fitsWithinAvailability(salon.timeMinutes, duration, availability.startTime, availability.endTime)) {
    throw new BookingError('OUTSIDE_HOURS');
  }

  let blocking = loadedBlocking;
  if (!blocking) {
    const window = salonDayWindow(date);
    const [existing, external] = await Promise.all([
      tx.appointment.findMany({
        where: {
          stylistId: appointment.stylistId,
          date: { gte: window.start, lte: window.end },
          status: { not: 'CANCELLED' },
          id: { not: appointment.id },
        },
        select: slotAppointmentSelect,
      }),
      loadExternalBusy(tx, [appointment.stylistId], window),
    ]);
    blocking = [
      ...existing.map((row) => ({ start: row.date, durationMin: row.durationAtBooking ?? row.service.duration })),
      ...external.map(toBookedInterval),
    ];
  }
  if (hasConflict(date, duration, blocking)) throw new SlotUnavailableError();
}

type SlotAppointment = { date: Date; service: { duration: number } };

/**
 * Build the bookable slot start-times for one stylist from already-fetched
 * availability + appointments. Thin adapter over the pure, prisma-free
 * `buildSlotsForWindow` (unit-tested in scheduling.test.ts). Shared by the
 * single-stylist and "Anyone" union paths so both compute slots identically.
 */
function buildStylistSlots(
  availability: { startTime: string; endTime: string },
  existingAppointments: SlotAppointment[],
  dateStr: string,
  serviceDuration: number,
  now: Date = new Date(),
): TimeSlot[] {
  const booked: BookedInterval[] = existingAppointments.map((appt) => ({
    start: new Date(appt.date),
    durationMin: appt.service.duration,
  }));
  return buildSlotsForWindow(dateStr, availability, booked, serviceDuration, now);
}

/**
 * Reduce a callers' date input to the single salon-local frame everything below
 * must share: the calendar date string (grid), the day window (conflict scan)
 * and the weekday (availability). Callers now pass a `YYYY-MM-DD` string (the
 * day the customer SAW); a legacy `Date` is still accepted for safety. Deriving
 * these three from a browser-local `Date` split them across three frames (UTC
 * date vs London window vs host weekday) — the wrong-day booking bug.
 */
function salonDayFrame(date: string | Date): { dateStr: string; dayOfWeek: number; window: { start: Date; end: Date } } {
  const dateStr = toSalonDateStr(date);
  // Noon is safely inside the salon calendar day (never near a DST/midnight edge),
  // so its window and weekday describe exactly `dateStr`.
  const salonNoon = resolveSalonDateTime(dateStr, '12:00');
  return { dateStr, dayOfWeek: salonNoon.dayOfWeek, window: salonDayWindow(salonNoon.utc) };
}

export async function getAvailableSlots(
  stylistId: string,
  date: string | Date,
  serviceDuration: number
): Promise<TimeSlot[]> {
  const { dateStr, dayOfWeek, window } = salonDayFrame(date);
  const now = new Date();
  if (window.start >= bookingCoverageEndsAt(now) || window.end <= now) return [];

  // 1. Get stylist availability for this day
  const availability = await prisma.availability.findFirst({
    where: { stylistId, dayOfWeek, isOff: false, stylist: { isActive: true } },
    select: { startTime: true, endTime: true },
  });
  if (!availability) {
    return [];
  }

  // 2. Get existing appointments for this stylist on this date. The appointment
  // query and the external-busy query are independent, so run them concurrently.
  const [existingAppointments, externalBlocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        stylistId,
        date: { gte: window.start, lte: window.end },
        status: { not: 'CANCELLED' },
      },
      select: slotAppointmentSelect,
    }),
    loadExternalBusy(prisma, [stylistId], window),
  ]);

  // 3. Merge Treatwell (external) busy blocks for this stylist/day, then build slots.
  // Use the frozen booking duration so a later service-duration edit doesn't make
  // us offer a slot the conflict check would then reject.
  const busy = [
    ...existingAppointments.map((appt) => ({
      ...appt,
      service: { duration: appt.durationAtBooking ?? appt.service.duration },
    })),
    ...externalBlocks.map(toSlotAppointment),
  ];

  return buildStylistSlots(availability, busy, dateStr, serviceDuration, now)
    .filter((slot) => isWithinBookingHorizon(resolveSalonDateTime(dateStr, slot.time).utc, serviceDuration, now));
}

/**
 * Union of available slot start-times across every stylist for a given date —
 * used by the "Anyone / first available" booking path so the customer sees a
 * slot whenever at least one stylist is free.
 *
 * Three batched reads: working hours, appointments and external busy blocks.
 * Their number is independent of stylist count — no per-stylist fan-out.
 */
export async function getAvailableSlotsUnion(
  date: string | Date,
  serviceDuration: number,
): Promise<TimeSlot[]> {
  const { dateStr, dayOfWeek, window } = salonDayFrame(date);
  const now = new Date();
  if (window.start >= bookingCoverageEndsAt(now) || window.end <= now) return [];

  const availabilities = await prisma.availability.findMany({
    where: { dayOfWeek, isOff: false, stylist: { isActive: true } },
    select: { stylistId: true, startTime: true, endTime: true },
  });
  if (availabilities.length === 0) return [];

  const stylistIds = availabilities.map((a) => a.stylistId);

  // The appointment query and the external-busy load are independent (both keyed
  // by stylistIds + the same day window), so run them concurrently.
  const [appointments, externalBlocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        stylistId: { in: stylistIds },
        date: { gte: window.start, lte: window.end },
        status: { not: 'CANCELLED' },
      },
      select: slotAppointmentSelect,
    }),
    loadExternalBusy(prisma, stylistIds, window),
  ]);

  const apptsByStylist = new Map<string, SlotAppointment[]>();
  for (const appt of appointments) {
    const list = apptsByStylist.get(appt.stylistId) ?? [];
    // Frozen booking duration wins over the live service duration (see getAvailableSlots).
    list.push({ ...appt, service: { duration: appt.durationAtBooking ?? appt.service.duration } });
    apptsByStylist.set(appt.stylistId, list);
  }

  // Merge Treatwell (external) busy blocks per stylist for this day.
  for (const row of externalBlocks) {
    const list = apptsByStylist.get(row.stylistId) ?? [];
    list.push(toSlotAppointment(row));
    apptsByStylist.set(row.stylistId, list);
  }

  const times = new Set<string>();
  for (const availability of availabilities) {
    const slots = buildStylistSlots(
      availability,
      apptsByStylist.get(availability.stylistId) ?? [],
      dateStr,
      serviceDuration,
      now,
    );
    for (const slot of slots) {
      if (slot.available && isWithinBookingHorizon(resolveSalonDateTime(dateStr, slot.time).utc, serviceDuration, now)) times.add(slot.time);
    }
  }

  return Array.from(times)
    .sort()
    .map((time) => ({ time, available: true }));
}

/**
 * Up to two weeks of the booking page's date strip and time grid for one
 * stylist or "Anyone". Three batched reads cover the whole range — working
 * hours, appointments and synced busy blocks (a Fresha "Pause" arrives as one
 * of those) — so a visit costs the same few queries however many days it shows.
 */
export async function getBookingDays(stylistId: string, dates: string[], serviceDuration: number): Promise<BookingDay[]> {
  if (dates.length === 0) return [];
  const now = new Date();
  const ordered = [...dates].sort();
  const window = {
    start: salonDayWindow(resolveSalonDateTime(ordered[0], '12:00').utc).start,
    end: salonDayWindow(resolveSalonDateTime(ordered[ordered.length - 1], '12:00').utc).end,
  };
  const rows = await prisma.availability.findMany({
    where: { isOff: false, stylist: { isActive: true }, ...(stylistId === ANY_STYLIST_ID ? {} : { stylistId }) },
    select: { stylistId: true, dayOfWeek: true, startTime: true, endTime: true },
  });
  const stylistIds = [...new Set(rows.map((row) => row.stylistId))];
  const [appointments, externalBlocks] = stylistIds.length === 0
    ? [[], []]
    : await Promise.all([
      prisma.appointment.findMany({
        where: { stylistId: { in: stylistIds }, date: { gte: window.start, lte: window.end }, status: { not: 'CANCELLED' } },
        select: slotAppointmentSelect,
      }),
      loadExternalBusy(prisma, stylistIds, window),
    ]);

  const hoursByStylist = new Map<string, WorkingHours[]>();
  for (const row of rows) hoursByStylist.set(row.stylistId, [...(hoursByStylist.get(row.stylistId) ?? []), row]);
  const busyByStylist = new Map<string, BookedInterval[]>();
  const addBusy = (id: string, interval: BookedInterval) => busyByStylist.set(id, [...(busyByStylist.get(id) ?? []), interval]);
  // Frozen booking duration wins over the live service duration (see getAvailableSlots).
  for (const appt of appointments) addBusy(appt.stylistId, { start: new Date(appt.date), durationMin: appt.durationAtBooking ?? appt.service.duration });
  for (const block of externalBlocks) addBusy(block.stylistId, toBookedInterval(block));

  return buildBookingDays({
    dates, duration: serviceDuration, now, hoursByStylist, busyByStylist,
    bookable: (start, duration) => isWithinBookingHorizon(start, duration, now),
  });
}

/**
 * The customer confirmed a price that is no longer the price (a new price list
 * went live, or an option was re-priced, between viewing and submitting).
 * Carries the CURRENT quote so the page can show it for a fresh confirmation;
 * nothing is written.
 */
export class PriceChangedError extends BookingError {
  readonly quote: PriceQuote;
  constructor(quote: PriceQuote) {
    super('PRICE_CHANGED');
    this.name = 'PriceChangedError';
    this.quote = quote;
  }
}

/**
 * Offers and discount codes are paused (pricing/policy.ts). A request that
 * still carries a code — an old tab, a crafted call — is refused before any
 * database work, so no code is ever validated, applied or counted as used.
 */
function refuseDiscountCode(code: string | undefined) {
  if (code && code.trim()) throw new DiscountUnavailableError('DISCOUNTS_PAUSED');
}

type NewBookingInput = {
  serviceId: string;
  date: Date;
  userId: string;
  /** Always refused while discounts are paused; accepted only to give a clear answer. */
  discountCode?: string;
  notes?: string;
  /** What the page showed. When given it must still be the live quote. */
  expectedQuote?: QuoteExpectation | null;
  /** Language the customer booked in; their emails for this booking use it. */
  locale?: Locale;
};

async function quoteInTx(tx: Prisma.TransactionClient, data: NewBookingInput) {
  const { service, quote } = await quoteForNewBooking(tx, data.serviceId, 'CUSTOMER');
  if (data.expectedQuote !== undefined && !quoteMatches(quote, data.expectedQuote)) throw new PriceChangedError(quote);
  return { service, quote };
}

function appointmentPriceFields(quote: PriceQuote, locale: Locale | undefined) {
  return {
    priceAtBooking: penceToDecimalString(quote.amountPence),
    quoteJson: serializeQuote(quote),
    notificationLocale: locale ?? null,
  };
}

export async function createBooking(data: NewBookingInput & { stylistId: string }) {
  refuseDiscountCode(data.discountCode);
  // Use Serializable transaction to prevent double-booking race conditions
  const appointment = await runSerializableWithRetry(async (tx) => {
    const settings = await assertOnlineBookingReady(tx);
    await assertActiveBookingLimit(tx, data.userId);
    const [{ service, quote }, stylist] = await Promise.all([
      quoteInTx(tx, data),
      tx.stylist.findUnique({
        where: { id: data.stylistId },
        select: { isActive: true, treatwellExternalId: true },
      }),
    ]);
    if (!stylist?.isActive) throw new BookingError('STYLIST_UNAVAILABLE');

    await assertAppointmentSlotAvailable(tx, { id: '', stylistId: data.stylistId, durationAtBooking: service.duration, service }, data.date);

    const api = getTreatwellApiConfiguration();
    const treatwellSyncStatus = initialTreatwellSyncStatus({
      apiEnabled: api.enabled && api.configured,
      stylistExternalId: stylist.treatwellExternalId,
      serviceExternalId: service.treatwellExternalId,
    });

    const created = await tx.appointment.create({
      data: {
        date: data.date,
        stylistId: data.stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        // Double-confirm flow: requests start PENDING and only become CONFIRMED
        // when an admin approves them from the schedule board (updateAppointmentStatus).
        status: 'PENDING',
        ...appointmentPriceFields(quote, data.locale),
        durationAtBooking: service.duration,
        notes: data.notes ?? null,
        treatwellSyncStatus,
      },
      include: {
        // phone is here for the salon's internal new-request alert email.
        user: { select: { email: true, name: true, phone: true } },
        stylist: { select: { name: true } },
        service: { select: { name: true, price: true, duration: true } },
      },
    });
    await enqueueAppointmentNotification(tx, 'REQUEST_RECEIVED', created, { salonPhone: settings.phone });
    await enqueueAppointmentNotification(tx, 'SALON_ALERT', created);
    return created;
  });

  return appointment;
}

/**
 * Create a booking for the first stylist (in the given priority order) who is
 * free for the whole appointment. Stylist resolution and the conflict check run
 * inside one Serializable transaction so two concurrent "Anyone" bookings can't
 * be assigned the same stylist for the same slot.
 */
export async function createBookingForFirstAvailable(data: NewBookingInput & { candidateStylistIds: string[] }) {
  refuseDiscountCode(data.discountCode);
  const appointment = await runSerializableWithRetry(async (tx) => {
    const settings = await assertOnlineBookingReady(tx);
    await assertActiveBookingLimit(tx, data.userId);
    const { service, quote } = await quoteInTx(tx, data);

    const { start: dayStart, end: dayEnd } = salonDayWindow(data.date);

    const existing = await tx.appointment.findMany({
      where: {
        stylistId: { in: data.candidateStylistIds },
        date: { gte: dayStart, lte: dayEnd },
        status: { not: 'CANCELLED' },
      },
      select: slotAppointmentSelect,
    });

    const bookedByStylist = new Map<string, BookedInterval[]>();
    for (const appt of existing) {
      const list = bookedByStylist.get(appt.stylistId) ?? [];
      // Frozen duration wins over the live service duration (see createBooking).
      list.push({ start: new Date(appt.date), durationMin: appt.durationAtBooking ?? appt.service.duration });
      bookedByStylist.set(appt.stylistId, list);
    }

    // Merge Treatwell (external) busy blocks per candidate stylist — loaded in-tx.
    const externalBlocks = await loadExternalBusy(tx, data.candidateStylistIds, { start: dayStart, end: dayEnd });
    for (const row of externalBlocks) {
      const list = bookedByStylist.get(row.stylistId) ?? [];
      list.push(toBookedInterval(row));
      bookedByStylist.set(row.stylistId, list);
    }

    const stylistId = firstFreeStylist(
      data.candidateStylistIds,
      data.date,
      service.duration,
      bookedByStylist,
    );

    if (!stylistId) {
      throw new SlotUnavailableError('NO_STYLIST_AT_TIME');
    }

    const stylist = await tx.stylist.findUnique({
      where: { id: stylistId },
      select: { isActive: true, treatwellExternalId: true },
    });
    if (!stylist?.isActive) throw new BookingError('STYLIST_UNAVAILABLE');

    const api = getTreatwellApiConfiguration();
    const treatwellSyncStatus = initialTreatwellSyncStatus({
      apiEnabled: api.enabled && api.configured,
      stylistExternalId: stylist.treatwellExternalId,
      serviceExternalId: service.treatwellExternalId,
    });

    await assertAppointmentSlotAvailable(tx, { id: '', stylistId, durationAtBooking: service.duration, service }, data.date, bookedByStylist.get(stylistId) ?? []);
    const created = await tx.appointment.create({
      data: {
        date: data.date,
        stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        // Double-confirm flow: requests start PENDING and only become CONFIRMED
        // when an admin approves them from the schedule board (updateAppointmentStatus).
        status: 'PENDING',
        ...appointmentPriceFields(quote, data.locale),
        durationAtBooking: service.duration,
        notes: data.notes ?? null,
        treatwellSyncStatus,
      },
      include: {
        // phone is here for the salon's internal new-request alert email.
        user: { select: { email: true, name: true, phone: true } },
        stylist: { select: { name: true } },
        service: { select: { name: true, price: true, duration: true } },
      },
    });
    await enqueueAppointmentNotification(tx, 'REQUEST_RECEIVED', created, { salonPhone: settings.phone });
    await enqueueAppointmentNotification(tx, 'SALON_ALERT', created);
    return created;
  });

  return appointment;
}

/**
 * Eligibility for booking a colour service on `colourDate`:
 * the user must have a COMPLETED patch-test appointment >=48h before and within 6 months.
 */
export async function getValidPatchTest(
  userId: string,
  colourDate: Date,
): Promise<EligibilityResult> {
  const tests = await prisma.appointment.findMany({
    where: { userId, service: { isPatchTest: true } },
    select: { date: true, status: true },
    orderBy: { date: 'desc' },
    take: 20,
  });
  return evaluatePatchTestEligibility(tests, colourDate);
}
