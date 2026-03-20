'use server';

import { createBooking, getAvailableSlots } from '@/app/services/booking-service';
import { sendBookingConfirmation } from '@/app/services/email-service';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import prisma from '@/app/lib/prisma';

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
  discountCode?: string;
};

const createBookingSchema = z.object({
  stylistId: z.string(),
  serviceId: z.string(),
  date: z.coerce.date(),
  time: z.string(), // HH:mm
  discountCode: z.string().optional(),
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

export async function validateDiscountCode(code: string) {
  if (!code) return { valid: false, error: 'Code is empty' };

  try {
    const discount = await prisma.discountCode.findUnique({
      where: { code },
    });

    if (!discount) return { valid: false, error: 'Invalid code' };
    if (!discount.isActive) return { valid: false, error: 'Code is inactive' };
    if (discount.expiresAt && new Date() > discount.expiresAt) return { valid: false, error: 'Code has expired' };
    if (discount.maxUses && discount.usedCount >= discount.maxUses) return { valid: false, error: 'Code usage limit reached' };

    return {
      valid: true,
      type: discount.type,
      value: Number(discount.value),
    };
  } catch (error) {
    console.error('Error validating discount code:', error);
    return { valid: false, error: 'Validation failed' };
  }
}

export async function submitBooking(data: z.infer<typeof createBookingSchema>) {
  // Require authentication
  const session = await verifySession();

  // Validate the input
  const result = createBookingSchema.safeParse(data);

  if (!result.success) {
    console.error('Validation failed:', result.error);
    return { success: false, error: 'Invalid booking data' };
  }

  const validData = result.data;

  // Validate discount code again server-side if provided
  let discountCodeId = undefined;
  if (validData.discountCode) {
    const discount = await prisma.discountCode.findUnique({
      where: { code: validData.discountCode },
    });
    if (discount && discount.isActive &&
        (!discount.expiresAt || new Date() <= discount.expiresAt) &&
        (!discount.maxUses || discount.usedCount < discount.maxUses)) {
      discountCodeId = discount.id;

      // Increment usage count
      await prisma.discountCode.update({
        where: { id: discount.id },
        data: { usedCount: { increment: 1 } },
      });
    }
  }

  // Parse time HH:mm
  const [hours, minutes] = validData.time.split(':').map(Number);
  const fullDate = new Date(validData.date);
  fullDate.setHours(hours, minutes, 0, 0);

  try {
    const appointment = await createBooking({
      stylistId: validData.stylistId,
      serviceId: validData.serviceId,
      date: fullDate,
      userId: session.userId,
      discountCodeId,
    });

    // Send confirmation email (fail silently — handled in email-service)
    await sendBookingConfirmation({
      id: appointment.id,
      date: appointment.date,
      user: appointment.user,
      stylist: appointment.stylist,
      service: {
        name: appointment.service.name,
        price: Number(appointment.service.price),
        duration: appointment.service.duration,
      },
    });

    revalidatePath('/book');
    revalidatePath('/appointments');
    revalidatePath('/admin');
    return { success: true };
  } catch (error) {
    console.error('Booking failed:', error);
    return { success: false, error: 'Failed to create booking' };
  }
}
