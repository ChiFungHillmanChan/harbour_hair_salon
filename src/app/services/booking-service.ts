import prisma from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import { addMinutes, format, setHours, setMinutes, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import {
  evaluatePatchTestEligibility,
  type EligibilityResult,
} from './patch-test-eligibility';
import { salonDayWindow } from './salon-time';
import { firstFreeStylist, type BookedInterval } from './scheduling';
import { loadExternalBusy, toBookedInterval, toSlotAppointment } from './external-busy';
import { SlotUnavailableError, DiscountUnavailableError } from './booking-errors';

const SALON_TIMEZONE = 'Europe/London';

export type TimeSlot = {
  time: string;
  available: boolean;
};

type SlotAppointment = { date: Date; service: { duration: number } };

/**
 * Build the bookable slot start-times for one stylist from already-fetched
 * availability + appointments. Pure aside from "now" (used to hide past slots on
 * the current day). Shared by the single-stylist and "Anyone" union paths so
 * both compute slots identically.
 */
function buildStylistSlots(
  availability: { startTime: string; endTime: string },
  existingAppointments: SlotAppointment[],
  date: Date,
  serviceDuration: number,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const startOfDayDate = startOfDay(date);

  const [startHour, startMinute] = availability.startTime.split(':').map(Number);
  const [endHour, endMinute] = availability.endTime.split(':').map(Number);

  let currentSlot = setMinutes(setHours(startOfDayDate, startHour), startMinute);
  const endTime = setMinutes(setHours(startOfDayDate, endHour), endMinute);
  const nowInLondon = toZonedTime(new Date(), SALON_TIMEZONE);
  const nowComparable = setMinutes(setHours(startOfDayDate, nowInLondon.getHours()), nowInLondon.getMinutes());

  while (addMinutes(currentSlot, serviceDuration) <= endTime) {
    // Skip slots that have already passed today (same-day only)
    if (date.toDateString() === nowInLondon.toDateString() && currentSlot <= nowComparable) {
      currentSlot = addMinutes(currentSlot, 30);
      continue;
    }
    const slotEnd = addMinutes(currentSlot, serviceDuration);

    const isBusy = existingAppointments.some((appt) => {
      const apptStart = new Date(appt.date);
      const apptEnd = addMinutes(apptStart, appt.service.duration);
      return (
        (currentSlot >= apptStart && currentSlot < apptEnd) ||
        (slotEnd > apptStart && slotEnd <= apptEnd) ||
        (currentSlot <= apptStart && slotEnd >= apptEnd)
      );
    });

    if (!isBusy) {
      slots.push({ time: format(currentSlot, 'HH:mm'), available: true });
    }

    currentSlot = addMinutes(currentSlot, 30);
  }

  return slots;
}

export async function getAvailableSlots(
  stylistId: string,
  date: Date,
  serviceDuration: number
): Promise<TimeSlot[]> {
  const dayOfWeek = date.getDay(); // 0-6

  // 1. Get stylist availability for this day
  const availability = await prisma.availability.findFirst({
    where: { stylistId, dayOfWeek, isOff: false },
  });
  if (!availability) {
    return [];
  }

  // 2. Get existing appointments for this stylist on this date
  const startOfDayDate = startOfDay(date);
  const endOfDayDate = new Date(startOfDayDate);
  endOfDayDate.setHours(23, 59, 59, 999);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      stylistId,
      date: { gte: startOfDayDate, lte: endOfDayDate },
      status: { not: 'CANCELLED' },
    },
    include: { service: { select: { duration: true } } },
  });

  // 3. Merge Treatwell (external) busy blocks for this stylist/day, then build slots
  const externalBlocks = await loadExternalBusy(prisma, [stylistId], salonDayWindow(date));
  const busy = [...existingAppointments, ...externalBlocks.map(toSlotAppointment)];

  return buildStylistSlots(availability, busy, date, serviceDuration);
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
  date: Date,
  serviceDuration: number,
): Promise<TimeSlot[]> {
  const dayOfWeek = date.getDay();

  const availabilities = await prisma.availability.findMany({
    where: { dayOfWeek, isOff: false },
    select: { stylistId: true, startTime: true, endTime: true },
  });
  if (availabilities.length === 0) return [];

  const stylistIds = availabilities.map((a) => a.stylistId);

  const startOfDayDate = startOfDay(date);
  const endOfDayDate = new Date(startOfDayDate);
  endOfDayDate.setHours(23, 59, 59, 999);

  const appointments = await prisma.appointment.findMany({
    where: {
      stylistId: { in: stylistIds },
      date: { gte: startOfDayDate, lte: endOfDayDate },
      status: { not: 'CANCELLED' },
    },
    include: { service: { select: { duration: true } } },
  });

  const apptsByStylist = new Map<string, SlotAppointment[]>();
  for (const appt of appointments) {
    const list = apptsByStylist.get(appt.stylistId) ?? [];
    list.push(appt);
    apptsByStylist.set(appt.stylistId, list);
  }

  // Merge Treatwell (external) busy blocks per stylist for this day.
  const externalBlocks = await loadExternalBusy(prisma, stylistIds, salonDayWindow(date));
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
      date,
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
  const discount = await tx.discountCode.findUnique({ where: { code } });
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
}) {
  // Use Serializable transaction to prevent double-booking race conditions
  const appointment = await prisma.$transaction(async (tx) => {
    const service = await tx.service.findUnique({ where: { id: data.serviceId } });
    if (!service) throw new Error('Service not found');

    const appointmentEnd = addMinutes(data.date, service.duration);
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
        durationMin: appt.service.duration,
      })),
      ...externalBlocks.map(toBookedInterval),
    ];

    const hasConflict = blocking.some((b) => {
      const bEnd = addMinutes(b.start, b.durationMin);
      return data.date < bEnd && b.start < appointmentEnd; // half-open overlap
    });

    if (hasConflict) {
      throw new SlotUnavailableError();
    }

    // Claim the discount in the same transaction (rolls back if the create fails).
    const discountCodeId = data.discountCode ? await claimDiscountInTx(tx, data.discountCode) : undefined;

    return tx.appointment.create({
      data: {
        date: data.date,
        stylistId: data.stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        status: 'CONFIRMED',
        discountCodeId,
      },
      include: {
        user: { select: { email: true, name: true } },
        stylist: { select: { name: true } },
        service: { select: { name: true, price: true, duration: true } },
      },
    });
  }, { isolationLevel: 'Serializable' });

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
}) {
  const appointment = await prisma.$transaction(async (tx) => {
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
      list.push({ start: new Date(appt.date), durationMin: appt.service.duration });
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

    const discountCodeId = data.discountCode ? await claimDiscountInTx(tx, data.discountCode) : undefined;

    return tx.appointment.create({
      data: {
        date: data.date,
        stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        status: 'CONFIRMED',
        discountCodeId,
      },
      include: {
        user: { select: { email: true, name: true } },
        stylist: { select: { name: true } },
        service: { select: { name: true, price: true, duration: true } },
      },
    });
  }, { isolationLevel: 'Serializable' });

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
