'use server';

import { createBooking, getAvailableSlots } from '@/app/services/booking-service';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const getSlotsSchema = z.object({
  stylistId: z.string(),
  date: z.string().transform((str) => new Date(str)),
  serviceDuration: z.number(),
});

const createBookingSchema = z.object({
  stylistId: z.string(),
  serviceId: z.string(),
  date: z.string().transform((str) => new Date(str)), // ISO string
  time: z.string(), // HH:mm
  userEmail: z.string().email(),
  userName: z.string().min(2),
  userPhone: z.string().optional(),
});

export async function getAvailableSlotsAction(prevState: any, formData: FormData) {
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

// Helper for client-side fetching without form state
export async function fetchSlots(stylistId: string, date: Date, serviceDuration: number) {
  try {
    return await getAvailableSlots(stylistId, date, serviceDuration);
  } catch (error) {
    console.error(error);
    return [];
  }
}

export async function submitBooking(data: z.infer<typeof createBookingSchema>) {
  // Parse date and time to create a full Date object
  // In a real app, we'd use the date object directly combined with time
  // But for simplicity, we assume the date object coming in is the selected day
  
  // Parse time HH:mm
  const [hours, minutes] = data.time.split(':').map(Number);
  const fullDate = new Date(data.date);
  fullDate.setHours(hours, minutes, 0, 0);

  try {
    await createBooking({
      stylistId: data.stylistId,
      serviceId: data.serviceId,
      date: fullDate,
      userEmail: data.userEmail,
      userName: data.userName,
      userPhone: data.userPhone,
    });

    revalidatePath('/book');
    return { success: true };
  } catch (error) {
    console.error('Booking failed:', error);
    return { success: false, error: 'Failed to create booking' };
  }
}

