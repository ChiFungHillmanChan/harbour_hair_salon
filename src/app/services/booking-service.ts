import prisma from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  evaluatePatchTestEligibility,
  type EligibilityResult,
} from './patch-test-eligibility';
import { salonDayWindow, toSalonDateStr, resolveSalonDateTime } from './salon-time';
import { firstFreeStylist, hasConflict, buildSlotsForWindow, type BookedInterval, type TimeSlot } from './scheduling';
import { loadExternalBusy, toBookedInterval, toSlotAppointment } from './external-busy';
import { SlotUnavailableError, DiscountUnavailableError } from './booking-errors';
import { getTreatwellApiConfiguration, initialTreatwellSyncStatus } from './treatwell-api';
import { getActiveGlobalOffer } from './offers-service';
import { applyOfferToPrice } from './offer-pricing';

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

  // 1. Get stylist availability for this day
  const availability = await prisma.availability.findFirst({
    where: { stylistId, dayOfWeek, isOff: false },
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
      include: { service: { select: { duration: true } } },
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

  return buildStylistSlots(availability, busy, dateStr, serviceDuration);
}

/**
 * Union of available slot start-times across every stylist for a given date —
 * used by the "Anyone / first available" booking path so the customer sees a
 * slot whenever at least one stylist is free.
 *
 * Two batched queries total (availability for the weekday + appointments for all
 * stylists in the day window), independent of stylist count — no per-stylist fan-out.
 */
export async function getAvailableSlotsUnion(
  date: string | Date,
  serviceDuration: number,
): Promise<TimeSlot[]> {
  const { dateStr, dayOfWeek, window } = salonDayFrame(date);

  const availabilities = await prisma.availability.findMany({
    where: { dayOfWeek, isOff: false },
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
      include: { service: { select: { duration: true } } },
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
    );
    for (const slot of slots) {
      if (slot.available) times.add(slot.time);
    }
  }

  return Array.from(times)
    .sort()
    .map((time) => ({ time, available: true }));
}

/**
 * Validate and claim a discount code INSIDE a booking transaction, so a booking
 * that later rolls back also rolls back the `usedCount` increment. Throws
 * DiscountUnavailableError if the code can't be claimed.
 */
async function claimDiscountInTx(tx: Prisma.TransactionClient, code: string): Promise<string> {
  // Codes are stored upper-cased; normalise so a lower-cased submission still matches.
  const discount = await tx.discountCode.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!discount || !discount.isActive) throw new DiscountUnavailableError();
  if (discount.expiresAt && new Date() > discount.expiresAt) throw new DiscountUnavailableError();
  if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) throw new DiscountUnavailableError();

  await tx.discountCode.update({
    where: { id: discount.id },
    data: { usedCount: { increment: 1 } },
  });
  return discount.id;
}

export async function createBooking(data: {
  stylistId: string;
  serviceId: string;
  date: Date;
  userId: string;
  discountCode?: string;
  notes?: string;
}) {
  // Snapshot the live global offer so the recorded price matches what the public
  // pages advertise. Read outside the tx: it is a rarely-changing announcement,
  // not part of the double-booking invariant.
  const globalOffer = await getActiveGlobalOffer();
  // Use Serializable transaction to prevent double-booking race conditions
  const appointment = await runSerializableWithRetry(async (tx) => {
    const [service, stylist] = await Promise.all([
      tx.service.findUnique({ where: { id: data.serviceId } }),
      tx.stylist.findUnique({
        where: { id: data.stylistId },
        select: { treatwellExternalId: true },
      }),
    ]);
    if (!service) throw new Error('Service not found');
    if (!stylist) throw new Error('Stylist not found');

    const { start: dayStart, end: dayEnd } = salonDayWindow(data.date);

    const existingAppointments = await tx.appointment.findMany({
      where: {
        stylistId: data.stylistId,
        date: { gte: dayStart, lte: dayEnd },
        status: { not: 'CANCELLED' },
      },
      include: { service: { select: { duration: true } } },
    });

    // Treatwell (external) busy blocks count as conflicts too — loaded in-tx.
    const externalBlocks = await loadExternalBusy(tx, [data.stylistId], { start: dayStart, end: dayEnd });
    const blocking: BookedInterval[] = [
      ...existingAppointments.map((appt) => ({
        start: new Date(appt.date),
        // Prefer the duration frozen at booking time so editing a service's
        // duration later cannot retroactively resize (and overlap) existing
        // bookings. Falls back to the live duration for legacy rows.
        durationMin: appt.durationAtBooking ?? appt.service.duration,
      })),
      ...externalBlocks.map(toBookedInterval),
    ];

    if (hasConflict(data.date, service.duration, blocking)) {
      throw new SlotUnavailableError();
    }

    // Claim the discount in the same transaction (rolls back if the create fails).
    const discountCodeId = data.discountCode ? await claimDiscountInTx(tx, data.discountCode) : undefined;

    const api = getTreatwellApiConfiguration();
    const treatwellSyncStatus = initialTreatwellSyncStatus({
      apiEnabled: api.enabled && api.configured,
      stylistExternalId: stylist.treatwellExternalId,
      serviceExternalId: service.treatwellExternalId,
    });

    return tx.appointment.create({
      data: {
        date: data.date,
        stylistId: data.stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        // Double-confirm flow: requests start PENDING and only become CONFIRMED
        // when an admin approves them from the schedule board (updateAppointmentStatus).
        status: 'PENDING',
        discountCodeId,
        priceAtBooking: applyOfferToPrice(Number(service.price), globalOffer),
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
  });

  return appointment;
}

/**
 * Create a booking for the first stylist (in the given priority order) who is
 * free for the whole appointment. Stylist resolution and the conflict check run
 * inside one Serializable transaction so two concurrent "Anyone" bookings can't
 * be assigned the same stylist for the same slot.
 */
export async function createBookingForFirstAvailable(data: {
  candidateStylistIds: string[];
  serviceId: string;
  date: Date;
  userId: string;
  discountCode?: string;
  notes?: string;
}) {
  const globalOffer = await getActiveGlobalOffer();
  const appointment = await runSerializableWithRetry(async (tx) => {
    const service = await tx.service.findUnique({ where: { id: data.serviceId } });
    if (!service) throw new Error('Service not found');

    const { start: dayStart, end: dayEnd } = salonDayWindow(data.date);

    const existing = await tx.appointment.findMany({
      where: {
        stylistId: { in: data.candidateStylistIds },
        date: { gte: dayStart, lte: dayEnd },
        status: { not: 'CANCELLED' },
      },
      include: { service: { select: { duration: true } } },
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
      throw new SlotUnavailableError('No stylist is available at this time. Please choose another time.');
    }

    const stylist = await tx.stylist.findUnique({
      where: { id: stylistId },
      select: { treatwellExternalId: true },
    });
    if (!stylist) throw new Error('Stylist not found');

    const discountCodeId = data.discountCode ? await claimDiscountInTx(tx, data.discountCode) : undefined;
    const api = getTreatwellApiConfiguration();
    const treatwellSyncStatus = initialTreatwellSyncStatus({
      apiEnabled: api.enabled && api.configured,
      stylistExternalId: stylist.treatwellExternalId,
      serviceExternalId: service.treatwellExternalId,
    });

    return tx.appointment.create({
      data: {
        date: data.date,
        stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        // Double-confirm flow: requests start PENDING and only become CONFIRMED
        // when an admin approves them from the schedule board (updateAppointmentStatus).
        status: 'PENDING',
        discountCodeId,
        priceAtBooking: applyOfferToPrice(Number(service.price), globalOffer),
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
