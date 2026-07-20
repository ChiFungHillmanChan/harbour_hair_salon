import 'server-only';
import type { ReactElement } from 'react';
import { Resend } from 'resend';
import { BookingConfirmation } from '@/components/emails/BookingConfirmation';
import { BookingCancellation } from '@/components/emails/BookingCancellation';
import { BookingReschedule } from '@/components/emails/BookingReschedule';
import { AppointmentReminder } from '@/components/emails/AppointmentReminder';
import { ReviewRequest, type ReviewRequestAppointment } from '@/components/emails/ReviewRequest';
import { NewsletterWelcome } from '@/components/emails/NewsletterWelcome';
import { buildBookingConfirmationText } from './booking-confirmation-copy';

export type AppointmentWithDetails = {
  id: string;
  date: Date;
  user: { email: string; name: string | null };
  stylist: { name: string };
  service: { name: string; price: number; duration: number };
};

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is required');
  return new Resend(apiKey);
}

// The sender address MUST be on a domain verified in Resend, or delivery to real
// customers is rejected. `onboarding@resend.dev` only reaches the Resend account
// owner, so it is a dev-only fallback — set EMAIL_FROM in production.
function getFromAddress(): string {
  return process.env.EMAIL_FROM || 'Harbour Hair Salon <onboarding@resend.dev>';
}

type SendArgs = {
  to: string;
  subject: string;
  react: ReactElement;
  text?: string;
  idempotencyKey?: string;
};

const SEND_TIMEOUT_MS = 10_000;

/**
 * Low-level send. Throws on any failure — including Resend's soft `{ error }`
 * return (the SDK does NOT throw on API errors like 4xx/429/domain issues), so
 * the caller can decide whether to fail loudly (cron: track + retry) or swallow
 * (booking flow: never fail a committed booking on an email hiccup).
 */
async function send({ to, subject, react, text, idempotencyKey }: SendArgs): Promise<void> {
  const resend = getResendClient();
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  const result = await Promise.race([
    resend.emails.send(
      {
        from: getFromAddress(),
        to,
        subject,
        react,
        ...(text ? { text } : {}),
        ...(replyTo ? { replyTo } : {}),
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Resend timed out after ${SEND_TIMEOUT_MS}ms for "${subject}" to ${to}`)), SEND_TIMEOUT_MS),
    ),
  ]);
  const { error } = result;
  if (error) {
    throw new Error(`Resend failed for "${subject}" to ${to}: ${error.message ?? String(error)}`);
  }
}

export async function sendBookingConfirmation(appointment: AppointmentWithDetails): Promise<void> {
  await send({
    to: appointment.user.email,
    subject: 'Your booking is confirmed — Harbour Hair Salon',
    react: BookingConfirmation({ appointment }),
    text: buildBookingConfirmationText(appointment),
    idempotencyKey: `booking-confirmation-${appointment.id}`,
  });
}

export async function sendBookingCancellation(appointment: AppointmentWithDetails): Promise<void> {
  await send({
    to: appointment.user.email,
    subject: 'Your booking has been cancelled — Harbour Hair Salon',
    react: BookingCancellation({ appointment }),
  });
}

export async function sendBookingReschedule(
  appointment: AppointmentWithDetails,
  oldDate: Date
): Promise<void> {
  await send({
    to: appointment.user.email,
    subject: 'Your booking has been rescheduled — Harbour Hair Salon',
    react: BookingReschedule({ appointment, oldDate }),
  });
}

export async function sendAppointmentReminder(appointment: AppointmentWithDetails): Promise<void> {
  await send({
    to: appointment.user.email,
    subject: 'Reminder: your appointment is tomorrow — Harbour Hair Salon',
    react: AppointmentReminder({ appointment }),
  });
}

export async function sendReviewRequest(appointment: ReviewRequestAppointment): Promise<void> {
  await send({
    to: appointment.user.email,
    subject: 'How was your visit? — Harbour Hair Salon',
    react: ReviewRequest({ appointment }),
  });
}

export async function sendNewsletterWelcome(email: string, phone: string): Promise<void> {
  await send({
    to: email,
    subject: 'Welcome to Harbour Hair Salon',
    react: NewsletterWelcome({ phone }),
  });
}
