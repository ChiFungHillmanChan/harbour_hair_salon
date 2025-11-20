'use server';

import { createBooking, getAvailableSlots } from '@/app/services/booking-service';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const getSlotsSchema = z.object({
  stylistId: z.string(),
  date: z.coerce.date(),
  serviceDuration: z.number(),
});

type CreateBookingInput = {
  stylistId: string;
  serviceId: string;
  date: Date | string;
  time: string;
  userEmail: string;
  userName: string;
  userPhone?: string;
};

const createBookingSchema = z.object({
  stylistId: z.string(),
  serviceId: z.string(),
  date: z.coerce.date(),
  time: z.string(), // HH:mm
  userEmail: z.string().email(),
  userName: z.string().min(2),
  userPhone: z.string().optional(),
}) satisfies z.ZodType<CreateBookingInput>;

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
  // Validate the input
  const result = createBookingSchema.safeParse(data);
  
  if (!result.success) {
    console.error('Validation failed:', result.error);
    return { success: false, error: 'Invalid booking data' };
  }

  const validData = result.data;

  // Parse time HH:mm
  const [hours, minutes] = validData.time.split(':').map(Number);
  const fullDate = new Date(validData.date);
  fullDate.setHours(hours, minutes, 0, 0);

  try {
    await createBooking({
      stylistId: validData.stylistId,
      serviceId: validData.serviceId,
      date: fullDate,
      userEmail: validData.userEmail,
      userName: validData.userName,
      userPhone: validData.userPhone,
    });

    revalidatePath('/book');
    revalidatePath('/admin'); // Also revalidate admin dashboard
    return { success: true };
  } catch (error) {
    console.error('Booking failed:', error);
    return { success: false, error: 'Failed to create booking' };
  }
}
