import 'server-only';
import { render } from '@react-email/components';
import { EmailFrame } from '@/components/emails/EmailFrame';
import { RESET_TOKEN_TTL_MS } from '@/app/lib/password-reset';
import { createUnsubscribeUrl, UNSUBSCRIBE_TOKEN_TTL_DAYS } from '@/app/lib/unsubscribe-token';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import {
  appointmentCalendarFile,
  appointmentEmailContent,
  isSalonEmailKind,
  marketingUnsubscribeContent,
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
import { mailboxAddress } from '@/app/lib/mailbox';
import { isPreviewEmailBlocked } from '@/app/lib/preview-email';
import type { IcsOrganizer } from '@/app/lib/calendar-links';

export type { AppointmentEmailKind, AppointmentEmailOptions } from './email-content';

/** @deprecated kept for old callers; see EmailAppointment in email-content.ts. */
export type AppointmentWithDetails = LegacyEmailAppointment;

/** Resend's attachment shape: `content` is base64. */
export type EmailAttachment = { filename: string; content: string; content_type?: string };

export type PreparedEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  /** The customer's calendar file on booking mail (see calendarMethodFor in email-content.ts). */
  attachments?: EmailAttachment[];
};

export function getSalonNotifyAddress(): string | null {
  return process.env.SALON_NOTIFY_EMAIL?.trim() || process.env.EMAIL_REPLY_TO?.trim() || null;
}

/** A one-off mail to the salon's own inbox (the daily ops alert). Never queued. */
export async function sendSalonNotice(content: EmailContent, idempotencyKey?: string): Promise<void> {
  const address = getSalonNotifyAddress();
  if (!address) throw new Error('SALON_NOTIFY_EMAIL or EMAIL_REPLY_TO is required');
  await sendPreparedEmail(await prepareEmail(address, content), idempotencyKey);
}

function getFromAddress(): string {
  const from = process.env.EMAIL_FROM?.trim();
  if (from) return from;
  if (process.env.NODE_ENV === 'production') throw new Error('EMAIL_FROM is required in production');
  return 'Harbour Hair Salon <onboarding@resend.dev>';
}

/**
 * The ORGANIZER of an emailed calendar file (RFC 5546 requires one on PUBLISH
 * and CANCEL): the salon, at the mailbox replies go to (EMAIL_REPLY_TO), else
 * at the sender (EMAIL_FROM) — either as a bare address or "Name <address>".
 * Omitted when neither holds a usable address.
 */
function calendarOrganizer(): IcsOrganizer | undefined {
  const email = mailboxAddress(process.env.EMAIL_REPLY_TO, true) ?? mailboxAddress(process.env.EMAIL_FROM, true);
  return email ? { name: 'Harbour Hair Salon', email } : undefined;
}

/** HTML and plain text are rendered from the same words. */
async function prepareEmail(to: string, content: EmailContent, attachments: EmailAttachment[] = []): Promise<PreparedEmail> {
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  return {
    from: getFromAddress(),
    to,
    subject: content.subject,
    html: await render(EmailFrame({ content })),
    text: renderPlainText(content),
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(attachments.length ? { attachments } : {}),
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
  if (isSalonEmailKind(kind)) {
    const address = getSalonNotifyAddress();
    if (!address) throw new Error('SALON_NOTIFY_EMAIL or EMAIL_REPLY_TO is required');
    return prepareEmail(address, content);
  }
  // A confirmed time carries an .ics that adds it to the customer's calendar; a
  // confirmed booking's cancellation, one that removes it. Built from the queued
  // snapshot alone, and frozen with the rest of the request so a retry sends
  // the identical file. RFC 5545 §3.7.2: an iCalendar object with METHOD goes
  // out with the same `method` parameter on its Content-Type.
  const calendar = appointmentCalendarFile(kind, normalized, locale, options, calendarOrganizer());
  return prepareEmail(normalized.user.email, content, calendar
    ? [{ filename: calendar.filename, content: Buffer.from(calendar.ics, 'utf8').toString('base64'), content_type: `text/calendar; charset=utf-8; method=${calendar.method}` }]
    : []);
}

/**
 * Abort the HTTP request itself; never log provider error bodies or recipient data.
 *
 * Every email leaves through here. On a Vercel preview — which runs on a copy
 * of production's customers — only recipients in PREVIEW_EMAIL_ALLOWLIST are
 * emailed (lib/preview-email.ts; unset: nobody). Anything else is dropped as
 * if sent, so the notification outbox does not retry it.
 */
export async function sendPreparedEmail(email: PreparedEmail, idempotencyKey?: string): Promise<void> {
  if (isPreviewEmailBlocked(email.to, { VERCEL_ENV: process.env.VERCEL_ENV, PREVIEW_EMAIL_ALLOWLIST: process.env.PREVIEW_EMAIL_ALLOWLIST })) {
    console.warn('Preview deployment: email not sent — the recipient is not in PREVIEW_EMAIL_ALLOWLIST');
    return;
  }
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
  const content = emailVerificationContent(token, EMAIL_VERIFICATION_TTL_HOURS, locale);
  await sendPreparedEmail(await prepareEmail(user.email, content));
}

/**
 * Reset tokens remain short-lived and are never written to the notification
 * queue. The mail uses the language of the page the reset was requested from.
 */
export async function sendPasswordReset(user: { email: string }, token: string, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const content = passwordResetContent(token, Math.round(RESET_TOKEN_TTL_MS / 60_000), locale);
  await sendPreparedEmail(await prepareEmail(user.email, content));
}

/**
 * The only way the public unsubscribe form changes the marketing list: a
 * signed link to the address itself. Like reset links, never queued.
 */
export async function sendMarketingUnsubscribeConfirmation(email: string, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const content = marketingUnsubscribeContent(await createUnsubscribeUrl(email, locale), UNSUBSCRIBE_TOKEN_TTL_DAYS, locale);
  await sendPreparedEmail(await prepareEmail(email, content));
}
