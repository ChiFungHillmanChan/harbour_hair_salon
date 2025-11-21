import prisma from '@/app/lib/prisma';
import { addMinutes, format, setHours, setMinutes, startOfDay } from 'date-fns';

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

  while (addMinutes(currentSlot, serviceDuration) <= endTime) {
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
  userEmail: string;
  userName: string;
  userPhone?: string;
  discountCodeId?: string;
}) {
  // 1. Find or create user
  let user = await prisma.user.findUnique({
    where: { email: data.userEmail },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: data.userEmail,
        name: data.userName,
        phone: data.userPhone,
      },
    });
  }

  // 2. Create appointment
  const appointment = await prisma.appointment.create({
    data: {
      date: data.date,
      stylistId: data.stylistId,
      serviceId: data.serviceId,
      userId: user.id,
      status: 'CONFIRMED', // Auto-confirm for now
      discountCodeId: data.discountCodeId,
    },
  });

  return appointment;
}
