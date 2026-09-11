import 'server-only';
import type { ReactElement } from 'react';
import { render } from '@react-email/components';
import { BookingConfirmation } from '@/components/emails/BookingConfirmation';
import { BookingCancellation } from '@/components/emails/BookingCancellation';
import { BookingReschedule } from '@/components/emails/BookingReschedule';
import { AppointmentReminder } from '@/components/emails/AppointmentReminder';
import { ReviewRequest, type ReviewRequestAppointment } from '@/components/emails/ReviewRequest';
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
export type AppointmentEmailKind = 'REQUEST_RECEIVED' | 'SALON_ALERT' | 'CONFIRMATION' | 'CANCELLATION' | 'RESCHEDULE' | 'REMINDER' | 'REVIEW_REQUEST';
export type PreparedEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
};
export type AppointmentEmailOptions = { salonPhone?: string; oldDate?: Date };

export function getSalonNotifyAddress(): string | null {
  return process.env.SALON_NOTIFY_EMAIL?.trim() || process.env.EMAIL_REPLY_TO?.trim() || null;
}

function getFromAddress(): string {
  const from = process.env.EMAIL_FROM?.trim();
  if (from) return from;
  if (process.env.NODE_ENV === 'production') throw new Error('EMAIL_FROM is required in production');
  return 'Harbour Hair Salon <onboarding@resend.dev>';
}

async function prepareEmail(to: string, subject: string, react: ReactElement, text?: string): Promise<PreparedEmail> {
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  return { from: getFromAddress(), to, subject, html: await render(react), ...(text ? { text } : {}), ...(replyTo ? { reply_to: replyTo } : {}) };
}

/** Frozen request bodies keep retries valid even across template/configuration changes. */
export async function prepareAppointmentEmail(
  kind: AppointmentEmailKind,
  appointment: AppointmentWithDetails & { notes?: string | null; user: AppointmentWithDetails['user'] & { phone?: string | null } },
  options: AppointmentEmailOptions = {},
): Promise<PreparedEmail> {
  const to = appointment.user.email;
  switch (kind) {
    case 'CONFIRMATION':
      return prepareEmail(to, 'Your booking is confirmed — Harbour Hair Salon', BookingConfirmation({ appointment }), buildBookingConfirmationText(appointment));
    case 'REQUEST_RECEIVED':
      return prepareEmail(to, 'We’ve received your booking request — Harbour Hair Salon', BookingRequestReceived({ appointment, salonPhone: options.salonPhone || '' }));
    case 'SALON_ALERT': {
      const address = getSalonNotifyAddress();
      if (!address) throw new Error('SALON_NOTIFY_EMAIL or EMAIL_REPLY_TO is required');
      return prepareEmail(address, 'New booking request — Harbour Hair Salon', NewBookingAlert({ appointment: { ...appointment, notes: appointment.notes ?? null, user: { ...appointment.user, phone: appointment.user.phone ?? null } } }));
    }
    case 'CANCELLATION':
      return prepareEmail(to, 'Your booking has been cancelled — Harbour Hair Salon', BookingCancellation({ appointment }));
    case 'RESCHEDULE':
      if (!options.oldDate) throw new Error('Reschedule notification requires the original date');
      return prepareEmail(to, 'Your booking has been rescheduled — Harbour Hair Salon', BookingReschedule({ appointment, oldDate: options.oldDate }));
    case 'REMINDER':
      return prepareEmail(to, `Reminder: your appointment is ${salonRelativeDay(appointment.date) ?? 'soon'} — Harbour Hair Salon`, AppointmentReminder({ appointment }));
    case 'REVIEW_REQUEST':
      return prepareEmail(to, 'How was your visit? — Harbour Hair Salon', ReviewRequest({ appointment }));
  }
}

/** Abort the HTTP request itself; never log provider error bodies or recipient data. */
export async function sendPreparedEmail(email: PreparedEmail, idempotencyKey?: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is required');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Email provider HTTP ${response.status}`);
  const result = await response.json();
  if (!result || typeof result.id !== 'string') throw new Error('Email provider returned an invalid response');
}

export async function sendBookingConfirmation(appointment: AppointmentWithDetails): Promise<void> {
  await sendPreparedEmail(await prepareAppointmentEmail('CONFIRMATION', appointment), `booking-confirmation-${appointment.id}`);
}
export async function sendBookingRequestReceived(appointment: AppointmentWithDetails, salonPhone: string): Promise<void> {
  await sendPreparedEmail(await prepareAppointmentEmail('REQUEST_RECEIVED', appointment, { salonPhone }), `booking-request-${appointment.id}`);
}
export async function sendNewBookingAlert(appointment: NewBookingAlertAppointment): Promise<void> {
  await sendPreparedEmail(await prepareAppointmentEmail('SALON_ALERT', appointment), `booking-alert-${appointment.id}`);
}
export async function sendBookingCancellation(appointment: AppointmentWithDetails): Promise<void> {
  await sendPreparedEmail(await prepareAppointmentEmail('CANCELLATION', appointment));
}
export async function sendBookingReschedule(appointment: AppointmentWithDetails, oldDate: Date): Promise<void> {
  await sendPreparedEmail(await prepareAppointmentEmail('RESCHEDULE', appointment, { oldDate }));
}
export async function sendAppointmentReminder(appointment: AppointmentWithDetails): Promise<void> {
  await sendPreparedEmail(await prepareAppointmentEmail('REMINDER', appointment));
}
export async function sendReviewRequest(appointment: ReviewRequestAppointment): Promise<void> {
  await sendPreparedEmail(await prepareEmail(appointment.user.email, 'How was your visit? — Harbour Hair Salon', ReviewRequest({ appointment })));
}

/** Reset tokens remain short-lived and are never written to the notification queue. */
export async function sendPasswordReset(user: { email: string; name: string | null }, token: string): Promise<void> {
  await sendPreparedEmail(await prepareEmail(user.email, 'Reset your password — Harbour Hair Salon', PasswordReset({ name: user.name, token, expiresInMinutes: Math.round(RESET_TOKEN_TTL_MS / 60_000) })));
}
