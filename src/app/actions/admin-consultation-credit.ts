'use server';

import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { BookingError } from '@/app/services/booking-errors';
import { findApplicableConsultationCredit } from '@/app/services/consultation-credit';
import { quoteForNewBooking } from '@/app/services/pricing/quote-service';
import { recordedPrice } from '@/app/services/pricing/recorded-price';
import { resolveSalonDateTime, SALON_DATE_RE, SALON_TIME_RE } from '@/app/services/salon-time';

export type ConsultationCreditPreview =
  | { available: false }
  | { available: true; amountPence: number; consultationDate: string };

const previewSchema = z.object({
  /** A customer picked from the search. */
  customerId: z.string().min(1).optional(),
  /** An email typed for a "new" customer: createAppointmentByAdmin books onto the account that already has it. */
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  /** The booking being edited: its own customer, and its own credit does not count as "used". */
  appointmentId: z.string().min(1).optional(),
  serviceId: z.string().min(1),
  dateStr: z.string().regex(SALON_DATE_RE),
  time: z.string().regex(SALON_TIME_RE),
});

const NONE: ConsultationCreditPreview = { available: false };

/**
 * What the booking dialog offers under "Consultation credit available" (spec
 * §2.3): the credit a consultation-required booking for this customer, service
 * and start would record. Admin-only and read-only — saving looks the credit up
 * again inside the booking's own transaction, so this answer is never trusted.
 */
export async function previewConsultationCredit(input: {
  customerId?: string;
  email?: string;
  appointmentId?: string;
  serviceId: string;
  dateStr: string;
  time: string;
}): Promise<ConsultationCreditPreview> {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return NONE;

  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return NONE;
  const { customerId, email, appointmentId, serviceId, dateStr, time } = parsed.data;
  const at = resolveSalonDateTime(dateStr, time).utc;
  if (Number.isNaN(at.getTime())) return NONE;

  try {
    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { requiresConsultation: true } });
    if (!service?.requiresConsultation) return NONE;

    // The customer and the price the save would use: the edited booking's
    // recorded price while its service is unchanged (null when it was never
    // recorded), otherwise the listed price of a new booking or service change.
    let userId: string | null = null;
    let recordedPence: number | null | undefined;
    let preferAppointmentId: string | undefined;
    if (appointmentId) {
      const booking = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { userId: true, serviceId: true, priceAtBooking: true, quoteJson: true, consultationCreditFromId: true },
      });
      if (!booking) return NONE;
      userId = booking.userId;
      preferAppointmentId = booking.consultationCreditFromId ?? undefined;
      if (booking.serviceId === serviceId) {
        const recorded = recordedPrice(booking);
        recordedPence = recorded.known ? recorded.amountPence : null;
      }
    } else if (customerId) {
      userId = customerId;
    } else if (email) {
      userId = (await prisma.user.findUnique({ where: { email }, select: { id: true } }))?.id ?? null;
    }
    if (!userId) return NONE;
    const treatmentPricePence = recordedPence !== undefined
      ? recordedPence
      : (await quoteForNewBooking(prisma, serviceId, 'ADMIN')).quote.amountPence;

    const credit = await findApplicableConsultationCredit(prisma, { userId, at, treatmentPricePence, excludeAppointmentId: appointmentId, preferAppointmentId });
    return credit ? { available: true, amountPence: credit.amountPence, consultationDate: credit.consultationDate.toISOString() } : NONE;
  } catch (error) {
    // A service that cannot be booked or priced offers no credit; saving reports the real problem.
    if (error instanceof BookingError) return NONE;
    // Anything else is NOT "no credit": that would tell the dialog a recorded
    // credit is gone. The dialog treats a rejected preview as unanswered.
    console.error('previewConsultationCredit failed', error);
    throw error;
  }
}
