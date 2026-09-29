import 'server-only';
import { render } from '@react-email/components';
import { EmailFrame } from '@/components/emails/EmailFrame';
import { RESET_TOKEN_TTL_MS } from '@/app/lib/password-reset';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import {
  appointmentEmailContent,
  passwordResetContent,
  renderPlainText,
  toEmailAppointment,
  type AppointmentEmailKind,
  type AppointmentEmailOptions,
  type EmailAppointment,
  type EmailContent,
  type LegacyEmailAppointment,
} from './email-content';
import { emailVerificationContent } from './email-content';
import { createEmailVerificationToken, EMAIL_VERIFICATION_TTL_HOURS } from '@/app/lib/email-verification';

export type { AppointmentEmailKind, AppointmentEmailOptions } from './email-content';

/** @deprecated kept for old callers; see EmailAppointment in email-content.ts. */
export type AppointmentWithDetails = LegacyEmailAppointment;

export type PreparedEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
};

export function getSalonNotifyAddress(): string | null {
  return process.env.SALON_NOTIFY_EMAIL?.trim() || process.env.EMAIL_REPLY_TO?.trim() || null;
}

function getFromAddress(): string {
  const from = process.env.EMAIL_FROM?.trim();
  if (from) return from;
  if (process.env.NODE_ENV === 'production') throw new Error('EMAIL_FROM is required in production');
  return 'Harbour Hair Salon <onboarding@resend.dev>';
}

/** HTML and plain text are rendered from the same words. */
async function prepareEmail(to: string, content: EmailContent): Promise<PreparedEmail> {
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  return {
    from: getFromAddress(),
    to,
    subject: content.subject,
    html: await render(EmailFrame({ content })),
    text: renderPlainText(content),
    ...(replyTo ? { reply_to: replyTo } : {}),
  };
}

/**
 * Frozen request bodies keep retries valid even across template/configuration
 * changes. `locale` is the language fixed on the queued event (customer mail:
 * the booking's language; salon alert: the salon's setting); events queued
 * before languages existed have none and are sent in English, as they would
 * have been.
 */
export async function prepareAppointmentEmail(
  kind: AppointmentEmailKind,
  appointment: EmailAppointment | LegacyEmailAppointment,
  options: AppointmentEmailOptions = {},
  locale: Locale = DEFAULT_LOCALE,
): Promise<PreparedEmail> {
  const normalized = toEmailAppointment(appointment);
  const content = appointmentEmailContent(kind, normalized, locale, options);
  if (kind === 'SALON_ALERT') {
    const address = getSalonNotifyAddress();
    if (!address) throw new Error('SALON_NOTIFY_EMAIL or EMAIL_REPLY_TO is required');
    return prepareEmail(address, content);
  }
  return prepareEmail(normalized.user.email, content);
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

/**
 * A fresh link proving the account receives mail at its address, in the
 * language of the page that asked. Never queued: it is re-sent on request.
 */
export async function sendEmailVerification(user: { id: string; email: string; name: string | null }, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const token = await createEmailVerificationToken(user, locale);
  const content = emailVerificationContent(user, token, EMAIL_VERIFICATION_TTL_HOURS, locale);
  await sendPreparedEmail(await prepareEmail(user.email, content));
}

/**
 * Reset tokens remain short-lived and are never written to the notification
 * queue. The mail uses the language of the page the reset was requested from.
 */
export async function sendPasswordReset(user: { email: string; name: string | null }, token: string, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const content = passwordResetContent(user, token, Math.round(RESET_TOKEN_TTL_MS / 60_000), locale);
  await sendPreparedEmail(await prepareEmail(user.email, content));
}
