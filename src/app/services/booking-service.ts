import prisma from '@/app/lib/prisma';
import { addMinutes, format, setHours, setMinutes, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

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
  // Use London timezone for "now" comparison to filter past slots correctly
  const now = toZonedTime(new Date(), SALON_TIMEZONE);

  while (addMinutes(currentSlot, serviceDuration) <= endTime) {
    // Skip slots that have already passed today
    if (currentSlot <= now) {
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
