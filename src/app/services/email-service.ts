import 'server-only';
import type { ReactElement } from 'react';
import { Resend } from 'resend';
import { BookingConfirmation } from '@/components/emails/BookingConfirmation';
import { BookingCancellation } from '@/components/emails/BookingCancellation';
import { BookingReschedule } from '@/components/emails/BookingReschedule';
import { AppointmentReminder } from '@/components/emails/AppointmentReminder';
import { ReviewRequest, type ReviewRequestAppointment } from '@/components/emails/ReviewRequest';
import { NewsletterWelcome } from '@/components/emails/NewsletterWelcome';
import { BookingRequestReceived } from '@/components/emails/BookingRequestReceived';
import { NewBookingAlert, type NewBookingAlertAppointment } from '@/components/emails/NewBookingAlert';
import { PasswordReset } from '@/components/emails/PasswordReset';
import { RESET_TOKEN_TTL_MS } from '@/app/lib/password-reset';
import { buildBookingConfirmationText } from './booking-confirmation-copy';
import { salonRelativeDay } from './salon-time';

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

/**
 * Where internal staff alerts go. SALON_NOTIFY_EMAIL wins; otherwise reuse
 * EMAIL_REPLY_TO, which is already the address the salon reads. Returns null
 * when neither is set so callers can skip (and log) instead of throwing.
 */
export function getSalonNotifyAddress(): string | null {
  return process.env.SALON_NOTIFY_EMAIL?.trim() || process.env.EMAIL_REPLY_TO?.trim() || null;
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

/**
 * Customer acknowledgement for a PENDING request. Idempotency-keyed on the
 * appointment id so a retry can never double-send.
 */
export async function sendBookingRequestReceived(
  appointment: AppointmentWithDetails,
  salonPhone: string,
): Promise<void> {
  await send({
    to: appointment.user.email,
    subject: 'We’ve received your booking request — Harbour Hair Salon',
    react: BookingRequestReceived({ appointment, salonPhone }),
    idempotencyKey: `booking-request-${appointment.id}`,
  });
}

/**
 * Internal alert to the salon that a request needs approving. No-ops (with a
 * warning) when no notification address is configured.
 */
export async function sendNewBookingAlert(appointment: NewBookingAlertAppointment): Promise<void> {
  const to = getSalonNotifyAddress();
  if (!to) {
    console.warn(
      'No SALON_NOTIFY_EMAIL or EMAIL_REPLY_TO configured — new booking request ' +
        `${appointment.id} was not announced to the salon.`,
    );
    return;
  }
  await send({
    to,
    subject: `New booking request: ${appointment.user.name || appointment.user.email}`,
    react: NewBookingAlert({ appointment }),
    idempotencyKey: `booking-alert-${appointment.id}`,
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
  // The reminder cron scans a 36h window, so the appointment may be today rather
  // than tomorrow — keep the subject line honest instead of always "tomorrow".
  const when = salonRelativeDay(appointment.date) ?? 'soon';
  await send({
    to: appointment.user.email,
    subject: `Reminder: your appointment is ${when} — Harbour Hair Salon`,
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

/**
 * Password reset link. Deliberately NOT idempotency-keyed: each request issues
 * a fresh token that invalidates the previous one, so every send must go out.
 */
export async function sendPasswordReset(
  user: { email: string; name: string | null },
  token: string,
): Promise<void> {
  await send({
    to: user.email,
    subject: 'Reset your password — Harbour Hair Salon',
    react: PasswordReset({
      name: user.name,
      token,
      expiresInMinutes: Math.round(RESET_TOKEN_TTL_MS / 60_000),
    }),
  });
}

export async function sendNewsletterWelcome(email: string, phone: string): Promise<void> {
  await send({
    to: email,
    subject: 'Welcome to Harbour Hair Salon',
    react: NewsletterWelcome({ phone }),
  });
}
