'use server';

import { createBooking, getAvailableSlots, getValidPatchTest } from '@/app/services/booking-service';
import { resolveSalonDateTime, isWithinAvailability, type SalonDateTime } from '@/app/services/salon-time';
import { sendBookingConfirmation, sendBookingCancellation, sendBookingReschedule } from '@/app/services/email-service';
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

// Shared business-hours guard for a resolved salon date/time against a stylist's
// availability for that weekday. Used by both the create and reschedule paths.
async function checkStylistHours(
  stylistId: string,
  salon: SalonDateTime,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const availability = await prisma.availability.findFirst({
    where: { stylistId, dayOfWeek: salon.dayOfWeek, isOff: false },
  });
  if (!availability) {
    return { ok: false, error: 'Stylist is not available on this day' };
  }
  if (!isWithinAvailability(salon.timeMinutes, availability.startTime, availability.endTime)) {
    return { ok: false, error: 'Selected time is outside business hours' };
  }
  return { ok: true };
}

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
  await verifySession();
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

  // Resolve the salon wall-clock time to the correct absolute UTC instant
  // (handles BST/GMT). Host-timezone independent — see salon-time.ts.
  const salon = resolveSalonDateTime(validData.date, validData.time);
  const fullDate = salon.utc;

  // Prevent booking in the past
  if (fullDate <= new Date()) {
    return { success: false, error: 'Cannot book a time in the past' };
  }

  // Validate time falls within stylist availability for this day
  const hoursCheck = await checkStylistHours(validData.stylistId, salon);
  if (!hoursCheck.ok) {
    return { success: false, error: hoursCheck.error };
  }

  // Colour services require a completed Consultation & Patch Test first.
  const service = await prisma.service.findUnique({
    where: { id: validData.serviceId },
    select: { requiresPatchTest: true },
  });
  if (service?.requiresPatchTest) {
    const eligibility = await getValidPatchTest(session.userId, fullDate);
    if (!eligibility.ok) {
      const message =
        eligibility.reason === 'too_soon'
          ? 'Your patch test must be at least 48 hours before a colour appointment.'
          : eligibility.reason === 'expired'
            ? 'Your patch test has expired (valid for 6 months). Please book a new Consultation & Patch Test.'
            : 'Colour services require a completed Consultation & Patch Test first. Please book that appointment.';
      return { success: false, error: message };
    }
  }

  // Atomically validate and claim the discount code within a transaction
  let discountCodeId = undefined;
  if (validData.discountCode) {
    try {
      discountCodeId = await prisma.$transaction(async (tx) => {
        const discount = await tx.discountCode.findUnique({
          where: { code: validData.discountCode },
        });

        if (!discount || !discount.isActive) return undefined;
        if (discount.expiresAt && new Date() > discount.expiresAt) return undefined;
        if (discount.maxUses !== null && discount.usedCount >= discount.maxUses) return undefined;

        await tx.discountCode.update({
          where: { id: discount.id },
          data: { usedCount: { increment: 1 } },
        });

        return discount.id;
      }, { isolationLevel: 'Serializable' });
    } catch {
      return { success: false, error: 'Discount code could not be applied. It may have been fully claimed.' };
    }
  }

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

export async function cancelAppointment(appointmentId: string) {
  const session = await verifySession();

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      user: { select: { email: true, name: true } },
      stylist: true,
      service: true,
    },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return { success: false, error: 'Appointment not found' };
  }

  if (appointment.status !== 'CONFIRMED') {
    return { success: false, error: 'Only confirmed appointments can be cancelled' };
  }

  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < 24) {
    return { success: false, error: 'Cannot cancel within 24 hours of appointment' };
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'CANCELLED' },
  });

  await sendBookingCancellation({
    ...appointment,
    service: { ...appointment.service, price: Number(appointment.service.price) },
  });

  revalidatePath('/appointments');
  revalidatePath('/admin');
  revalidatePath('/book');
  return { success: true };
}

export async function checkColourEligibility(serviceId: string, dateIso: string) {
  const session = await verifySession();
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { requiresPatchTest: true },
  });
  if (!service?.requiresPatchTest) {
    return { requiresTest: false, eligible: true, reason: 'eligible' as const, testDate: null };
  }
  const eligibility = await getValidPatchTest(session.userId, new Date(dateIso));
  return {
    requiresTest: true,
    eligible: eligibility.ok,
    reason: eligibility.reason,
    testDate: eligibility.testDate ? eligibility.testDate.toISOString() : null,
  };
}

export async function rescheduleAppointment(appointmentId: string, dateStr: string, time: string) {
  const session = await verifySession();

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      user: { select: { email: true, name: true } },
      stylist: true,
      service: true,
    },
  });

  if (!appointment || appointment.userId !== session.userId) {
    return { success: false, error: 'Appointment not found' };
  }

  if (appointment.status !== 'CONFIRMED') {
    return { success: false, error: 'Only confirmed appointments can be rescheduled' };
  }

  const hoursUntil = (appointment.date.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < 24) {
    return { success: false, error: 'Cannot reschedule within 24 hours of appointment' };
  }

  // Resolve the new salon wall-clock time to the correct absolute UTC instant
  // (handles BST/GMT) — the create path did this but reschedule previously did not.
  const salon = resolveSalonDateTime(dateStr, time);
  const newDate = salon.utc;

  // Prevent rescheduling into the past
  if (newDate <= new Date()) {
    return { success: false, error: 'Cannot reschedule to a time in the past' };
  }

  // Validate the new time falls within stylist availability for this day
  const hoursCheck = await checkStylistHours(appointment.stylistId, salon);
  if (!hoursCheck.ok) {
    return { success: false, error: hoursCheck.error };
  }

  // Re-validate the colour patch-test gate against the NEW date.
  if (appointment.service.requiresPatchTest) {
    const eligibility = await getValidPatchTest(session.userId, newDate);
    if (!eligibility.ok) {
      const message =
        eligibility.reason === 'too_soon'
          ? 'Your patch test must be at least 48 hours before a colour appointment.'
          : eligibility.reason === 'expired'
            ? 'Your patch test has expired (valid for 6 months). Please book a new Consultation & Patch Test.'
            : 'Colour services require a completed Consultation & Patch Test first.';
      return { success: false, error: message };
    }
  }

  try {
    const oldDate = appointment.date;

    await prisma.$transaction(async (tx) => {
      // Check for overlapping appointments using duration-based range
      const { startOfDay } = await import('date-fns');
      const { addMinutes } = await import('date-fns');

      const dayStart = startOfDay(newDate);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const newEnd = addMinutes(newDate, appointment.service.duration);

      const existingAppointments = await tx.appointment.findMany({
        where: {
          stylistId: appointment.stylistId,
          date: { gte: dayStart, lte: dayEnd },
          status: { not: 'CANCELLED' },
          id: { not: appointmentId },
        },
        include: { service: true },
      });

      const hasConflict = existingAppointments.some((appt) => {
        const apptStart = new Date(appt.date);
        const apptEnd = addMinutes(apptStart, appt.service.duration);
        return (
          (newDate >= apptStart && newDate < apptEnd) ||
          (newEnd > apptStart && newEnd <= apptEnd) ||
          (newDate <= apptStart && newEnd >= apptEnd)
        );
      });

      if (hasConflict) {
        throw new Error('This time slot is no longer available');
      }

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { date: newDate, reminderSent: false },
      });
    }, { isolationLevel: 'Serializable' });

    const updated = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        user: { select: { email: true, name: true } },
        stylist: true,
        service: true,
      },
    });

    if (updated) {
      await sendBookingReschedule(
        { ...updated, service: { ...updated.service, price: Number(updated.service.price) } },
        oldDate,
      );
    }

    revalidatePath('/appointments');
    revalidatePath('/admin');
    revalidatePath('/book');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reschedule failed';
    return { success: false, error: message };
  }
}
