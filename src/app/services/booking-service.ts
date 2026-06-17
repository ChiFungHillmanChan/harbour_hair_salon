import prisma from '@/app/lib/prisma';
import { addMinutes, format, setHours, setMinutes, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import {
  evaluatePatchTestEligibility,
  type EligibilityResult,
} from './patch-test-eligibility';
import { firstFreeStylist, type BookedInterval } from './scheduling';

const SALON_TIMEZONE = 'Europe/London';

export type TimeSlot = {
  time: string;
  available: boolean;
};

export async function getAvailableSlots(
  stylistId: string,
  date: Date,
  serviceDuration: number
): Promise<TimeSlot[]> {
  const dayOfWeek = date.getDay(); // 0-6

  // 1. Get stylist availability for this day
  const availability = await prisma.availability.findFirst({
    where: {
      stylistId,
      dayOfWeek,
      isOff: false, // Only get slots if the stylist is NOT off
    },
  });

  // If no availability record found or isOff is true (though filtered above), return no slots
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
      date: {
        gte: startOfDayDate,
        lte: endOfDayDate,
      },
      status: {
        not: 'CANCELLED',
      },
    },
    include: {
      service: true,
    },
  });

  // 3. Generate slots
  const slots: TimeSlot[] = [];

  // Parse start and end times from availability string "HH:mm"
  const [startHour, startMinute] = availability.startTime.split(':').map(Number);
  const [endHour, endMinute] = availability.endTime.split(':').map(Number);

  let currentSlot = setMinutes(setHours(startOfDayDate, startHour), startMinute);
  const endTime = setMinutes(setHours(startOfDayDate, endHour), endMinute);
  // Convert "now" to the same date-basis as slots for consistent comparison
  const nowUtc = new Date();
  const nowInLondon = toZonedTime(nowUtc, SALON_TIMEZONE);
  // Build a comparable "now" on the same startOfDay date-basis used by slots
  const nowComparable = setMinutes(setHours(startOfDayDate, nowInLondon.getHours()), nowInLondon.getMinutes());

  while (addMinutes(currentSlot, serviceDuration) <= endTime) {
    // Skip slots that have already passed today (same-day only)
    if (date.toDateString() === nowInLondon.toDateString() && currentSlot <= nowComparable) {
      currentSlot = addMinutes(currentSlot, 30);
      continue;
    }
    const slotEnd = addMinutes(currentSlot, serviceDuration);

    // Check collision with existing appointments
    const isBusy = existingAppointments.some((appt) => {
      const apptStart = new Date(appt.date);
      const apptEnd = addMinutes(apptStart, appt.service.duration);

      // Check for overlap
      return (
        (currentSlot >= apptStart && currentSlot < apptEnd) ||
        (slotEnd > apptStart && slotEnd <= apptEnd) ||
        (currentSlot <= apptStart && slotEnd >= apptEnd)
      );
    });

    // Only add the slot if it is not busy
    if (!isBusy) {
      slots.push({
        time: format(currentSlot, 'HH:mm'),
        available: true,
      });
    }

    // Interval - let's assume 30 min slots for start times, or dynamic based on logic
    // For simplicity, increment by 30 mins
    currentSlot = addMinutes(currentSlot, 30);
  }

  return slots;
}

export async function createBooking(data: {
  stylistId: string;
  serviceId: string;
  date: Date;
  userId: string;
  discountCodeId?: string;
}) {
  // Use Serializable transaction to prevent double-booking race conditions
  const appointment = await prisma.$transaction(async (tx) => {
    // Check for conflicting appointments within the time range
    const service = await tx.service.findUnique({ where: { id: data.serviceId } });
    if (!service) throw new Error('Service not found');

    const appointmentEnd = addMinutes(data.date, service.duration);
    const dayStart = startOfDay(data.date);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const existingAppointments = await tx.appointment.findMany({
      where: {
        stylistId: data.stylistId,
        date: { gte: dayStart, lte: dayEnd },
        status: { not: 'CANCELLED' },
      },
      include: { service: true },
    });

    const hasConflict = existingAppointments.some((appt) => {
      const apptStart = new Date(appt.date);
      const apptEnd = addMinutes(apptStart, appt.service.duration);
      return (
        (data.date >= apptStart && data.date < apptEnd) ||
        (appointmentEnd > apptStart && appointmentEnd <= apptEnd) ||
        (data.date <= apptStart && appointmentEnd >= apptEnd)
      );
    });

    if (hasConflict) {
      throw new Error('This time slot is no longer available. Please choose another time.');
    }

    return tx.appointment.create({
      data: {
        date: data.date,
        stylistId: data.stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        status: 'CONFIRMED',
        discountCodeId: data.discountCodeId,
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
 * Union of available slot start-times across every stylist for a given date —
 * used by the "Anyone / first available" booking path so the customer sees a
 * slot whenever at least one stylist is free.
 */
export async function getAvailableSlotsUnion(
  date: Date,
  serviceDuration: number,
): Promise<TimeSlot[]> {
  const stylists = await prisma.stylist.findMany({ select: { id: true } });
  const perStylist = await Promise.all(
    stylists.map((s) => getAvailableSlots(s.id, date, serviceDuration)),
  );

  const times = new Set<string>();
  for (const slots of perStylist) {
    for (const slot of slots) {
      if (slot.available) times.add(slot.time);
    }
  }

  return Array.from(times)
    .sort()
    .map((time) => ({ time, available: true }));
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
  discountCodeId?: string;
}) {
  const appointment = await prisma.$transaction(async (tx) => {
    const service = await tx.service.findUnique({ where: { id: data.serviceId } });
    if (!service) throw new Error('Service not found');

    const dayStart = startOfDay(data.date);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const existing = await tx.appointment.findMany({
      where: {
        stylistId: { in: data.candidateStylistIds },
        date: { gte: dayStart, lte: dayEnd },
        status: { not: 'CANCELLED' },
      },
      include: { service: true },
    });

    const bookedByStylist = new Map<string, BookedInterval[]>();
    for (const appt of existing) {
      const list = bookedByStylist.get(appt.stylistId) ?? [];
      list.push({ start: new Date(appt.date), durationMin: appt.service.duration });
      bookedByStylist.set(appt.stylistId, list);
    }

    const stylistId = firstFreeStylist(
      data.candidateStylistIds,
      data.date,
      service.duration,
      bookedByStylist,
    );

    if (!stylistId) {
      throw new Error('No stylist is available at this time. Please choose another time.');
    }

    return tx.appointment.create({
      data: {
        date: data.date,
        stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        status: 'CONFIRMED',
        discountCodeId: data.discountCodeId,
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
