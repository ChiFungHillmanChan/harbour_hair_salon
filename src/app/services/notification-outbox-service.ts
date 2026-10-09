import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Appointment, Prisma, PrismaClient, Service, Stylist, User } from '@prisma/client';
import prisma from '@/app/lib/prisma';
import { isPlaceholderEmail } from '@/app/lib/walk-in-customer';
import { prepareAppointmentEmail, sendPreparedEmail, type AppointmentEmailKind, type AppointmentEmailOptions, type PreparedEmail } from './email-service';
import { isSalonEmailKind, RESCHEDULE_REQUEST_EMAIL_KINDS, type EmailPrice } from './email-content';
import { recordedPrice } from './pricing/recorded-price';
import { DEFAULT_LOCALE, isLocale, localeOrDefault, type Locale } from '@/i18n/config';

type QueueDb = Pick<Prisma.TransactionClient, 'notificationDelivery' | 'appointment'> & Partial<Pick<Prisma.TransactionClient, 'contentTranslation' | 'siteSettings'>>;
type NotificationAppointment = Pick<Appointment, 'id' | 'date' | 'priceAtBooking' | 'durationAtBooking' | 'notificationVersion' | 'notes'>
  & Partial<Pick<Appointment, 'quoteJson' | 'notificationLocale' | 'serviceId'>> & {
  user: Pick<User, 'email' | 'name'> & Partial<Pick<User, 'phone'>>;
  stylist: Pick<Stylist, 'name'>;
  service: Pick<Service, 'name' | 'duration'> & Partial<Pick<Service, 'id' | 'price'>>;
};

/**
 * Snapshot schema 2 (current): the service name already in the event's
 * language, the booking's frozen price with its NHS/VAT meaning, and the
 * language itself. Schema 1 events (queued before languages existed) carry
 * `service.price` and no locale; they are still delivered, in English, with no
 * NHS/VAT wording added after the fact.
 */
type SnapshotV2 = {
  schema: 2;
  id: string;
  date: string;
  notes: string | null;
  user: { email: string; name: string | null; phone?: string | null };
  stylist: { name: string };
  service: { name: string; duration: number };
  price: EmailPrice;
};
type SnapshotV1 = { id: string; date: string; notes?: string | null; user: SnapshotV2['user']; stylist: SnapshotV2['stylist']; service: { name: string; price: number; duration: number } };
type NotificationPayload = {
  version: number;
  date: string;
  locale?: Locale;
  email?: PreparedEmail;
  appointment?: SnapshotV1 | SnapshotV2;
  options?: { salonPhone?: string; oldDate?: string; requestedDate?: string; requestedAt?: string };
};

/** The customer's language for their own mail; never the language of whoever triggered the event. */
function eventLocale(kind: AppointmentEmailKind, appointment: NotificationAppointment, salonLocale: Locale): Locale {
  return isSalonEmailKind(kind) ? salonLocale : localeOrDefault(appointment.notificationLocale);
}

async function salonLocaleFrom(db: QueueDb): Promise<Locale> {
  // The salon's own alerts default to Traditional Chinese (owner decision).
  if (!db.siteSettings) return 'zh-HK';
  const settings = await db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { salonNotificationLocale: true } });
  return isLocale(settings?.salonNotificationLocale) ? settings.salonNotificationLocale : 'zh-HK';
}

/** The PUBLISHED name of the booked service in `locale`, falling back to the booked (English) name. */
async function serviceNameIn(db: QueueDb, appointment: NotificationAppointment, locale: Locale): Promise<string> {
  const serviceId = appointment.serviceId ?? appointment.service.id;
  if (locale === DEFAULT_LOCALE || !serviceId || !db.contentTranslation) return appointment.service.name;
  const row = await db.contentTranslation.findUnique({
    where: { entityType_entityId_locale: { entityType: 'SERVICE', entityId: serviceId, locale } },
    select: { fieldsJson: true },
  });
  try {
    const name = row ? (JSON.parse(row.fieldsJson) as { name?: unknown }).name : null;
    return typeof name === 'string' && name.trim() ? name : appointment.service.name;
  } catch {
    return appointment.service.name;
  }
}

function emailPrice(appointment: NotificationAppointment): EmailPrice {
  const recorded = recordedPrice({ priceAtBooking: appointment.priceAtBooking, quoteJson: appointment.quoteJson ?? null });
  if (!recorded.known) return { known: false };
  return { known: true, amountPence: recorded.amountPence, priceType: recorded.priceType, vatDisplay: recorded.vatDisplay, priceNature: recorded.priceNature };
}
const LEASE_MS = 5 * 60_000;
const RETRY_WINDOW_MS = 23 * 60 * 60_000;
const MAX_ATTEMPTS = 12;

/** Must be called inside the appointment transaction, before it commits. */
export async function enqueueAppointmentNotification(
  db: QueueDb,
  kind: AppointmentEmailKind,
  appointment: NotificationAppointment,
  options: AppointmentEmailOptions & { requestedAt?: Date } = {},
) {
  // Phone bookings have an unroutable identity, but may still alert the salon.
  if (!isSalonEmailKind(kind) && isPlaceholderEmail(appointment.user.email)) return null;
  const forRequest = RESCHEDULE_REQUEST_EMAIL_KINDS.includes(kind);
  if (forRequest && (!options.requestedAt || !options.requestedDate)) {
    throw new Error(`${kind} requires requestedDate and requestedAt`);
  }
  // A replaced request is a different event: key request mail by the request.
  const eventKey = `appointment/${appointment.id}/${appointment.notificationVersion}/${kind}${forRequest ? `/${options.requestedAt!.toISOString()}` : ''}`;
  // Fast path avoids regenerating a date-relative subject for an existing event.
  const existing = await db.notificationDelivery.findUnique({ where: { eventKey }, select: { id: true } });
  if (existing) return existing;
  const locale = eventLocale(kind, appointment, isSalonEmailKind(kind) ? await salonLocaleFrom(db) : DEFAULT_LOCALE);
  const snapshot: SnapshotV2 = {
    schema: 2,
    id: appointment.id,
    date: appointment.date.toISOString(),
    notes: appointment.notes,
    user: { email: appointment.user.email, name: appointment.user.name, phone: appointment.user.phone },
    stylist: { name: appointment.stylist.name },
    service: { name: await serviceNameIn(db, appointment, locale), duration: appointment.durationAtBooking ?? appointment.service.duration },
    // The booking's own frozen amount, never today's price list; unknown stays unknown.
    price: emailPrice(appointment),
  };
  // Saving a booking/cancellation must not depend on email configuration or rendering.
  const payload: NotificationPayload = { version: appointment.notificationVersion, date: appointment.date.toISOString(), locale, appointment: snapshot, options: { salonPhone: options.salonPhone, oldDate: options.oldDate?.toISOString(), requestedDate: options.requestedDate?.toISOString(), requestedAt: options.requestedAt?.toISOString() } };
  return db.notificationDelivery.upsert({
    where: { eventKey },
    create: { eventKey, appointmentId: appointment.id, kind, payloadJson: JSON.stringify(payload) },
    update: {},
    select: { id: true },
  });
}

async function isCurrent(db: QueueDb, appointmentId: string | null, kind: string, payload: NotificationPayload, now: Date) {
  if (!appointmentId) return false;
  const current = await db.appointment.findUnique({ where: { id: appointmentId }, select: { date: true, status: true, notificationVersion: true, rescheduleRequestedAt: true, review: { select: { id: true } } } });
  if (!current || current.notificationVersion !== payload.version || current.date.toISOString() !== payload.date) return false;
  const thisRequestOpen = Boolean(payload.options?.requestedAt) && current.rescheduleRequestedAt?.toISOString() === payload.options?.requestedAt;
  switch (kind) {
    case 'CANCELLATION': return current.status === 'CANCELLED';
    case 'REQUEST_RECEIVED':
    case 'SALON_ALERT': return current.status === 'PENDING' && current.date > now;
    case 'CONFIRMATION':
    case 'RESCHEDULE':
    case 'REMINDER': return current.status === 'CONFIRMED' && current.date > now;
    case 'REVIEW_REQUEST': return ['CONFIRMED', 'COMPLETED'].includes(current.status) && current.date < now && !current.review;
    // Mail about an open request goes only while that same request is open.
    case 'RESCHEDULE_REQUEST_RECEIVED':
    case 'SALON_RESCHEDULE_ALERT':
      return current.status === 'CONFIRMED' && thisRequestOpen && new Date(payload.options!.requestedDate!) > now;
    // Mail about a closed request goes only while the original booking stands.
    case 'RESCHEDULE_DECLINED':
    case 'RESCHEDULE_LAPSED':
      return current.status === 'CONFIRMED' && !thisRequestOpen && current.date > now;
    default: return false;
  }
}

export async function dispatchPendingNotifications(options: { db?: PrismaClient; now?: Date; limit?: number; budgetMs?: number; appointmentId?: string } = {}) {
  const result = { sent: 0, failed: 0, skipped: 0, deferred: 0 };
  // Immediate actions and scheduled workers share the same delivery switch.
  // Preserve queued events while disabled so valid ones can resume later.
  if (process.env.NOTIFICATIONS_ENABLED !== 'true') return result;
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();
  const started = Date.now();
  const budgetMs = options.budgetMs ?? 40_000;
  const eligible: Prisma.NotificationDeliveryWhereInput = {
    ...(options.appointmentId ? { appointmentId: options.appointmentId } : {}),
    OR: [{ status: 'PENDING', nextAttemptAt: { lte: now } }, { status: 'PROCESSING', lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } }],
  };
  const rows = await db.notificationDelivery.findMany({ where: eligible, orderBy: { createdAt: 'asc' }, take: options.limit ?? 20, select: { id: true, firstAttemptAt: true } });
  for (const candidate of rows) {
    // Reserve a complete HTTP timeout plus persistence time before starting.
    if (Date.now() - started + 12_000 > budgetMs) { result.deferred++; continue; }
    const lockToken = randomUUID();
    const claim = await db.notificationDelivery.updateMany({ where: { id: candidate.id, ...eligible }, data: { status: 'PROCESSING', lockedAt: now, lockToken, firstAttemptAt: candidate.firstAttemptAt ?? now, attempts: { increment: 1 } } });
    if (claim.count !== 1) continue;
    const row = await db.notificationDelivery.findUnique({ where: { id: candidate.id } });
    if (!row || row.lockToken !== lockToken) continue;
    const finish = (data: Prisma.NotificationDeliveryUpdateManyMutationInput) => db.notificationDelivery.updateMany({ where: { id: row.id, lockToken }, data: { ...data, lockToken: null, lockedAt: null } });
    try {
      // An unknown outcome must not resend after Resend's 24-hour key retention.
      if (row.attempts > 1 && row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= RETRY_WINDOW_MS) {
        await finish({ status: 'FAILED', lastError: 'Retry window expired. Check provider delivery logs before any manual resend.' });
        result.failed++;
        continue;
      }
      const payload = JSON.parse(row.payloadJson) as NotificationPayload;
      const placeholderRecipient = payload.email
        ? isPlaceholderEmail(payload.email.to)
        : !isSalonEmailKind(row.kind as AppointmentEmailKind) && isPlaceholderEmail(payload.appointment?.user.email);
      if (placeholderRecipient || !Number.isInteger(payload.version) || !(await isCurrent(db, row.appointmentId, row.kind, payload, now))) {
        await finish({ status: 'SKIPPED', lastError: null, payloadJson: '{}' });
        result.skipped++;
        continue;
      }
      if (!payload.email) {
        if (!payload.appointment) throw new Error('Notification snapshot is missing');
        payload.email = await prepareAppointmentEmail(
          row.kind as AppointmentEmailKind,
          { ...payload.appointment, date: new Date(payload.appointment.date) },
          { ...payload.options, oldDate: payload.options?.oldDate ? new Date(payload.options.oldDate) : undefined, requestedDate: payload.options?.requestedDate ? new Date(payload.options.requestedDate) : undefined, now },
          // Schema-1 events have no language: English, as they were written.
          localeOrDefault(payload.locale),
        );
        // Persist the exact request before transmission so ambiguous retries stay identical.
        const saved = await db.notificationDelivery.updateMany({ where: { id: row.id, lockToken }, data: { payloadJson: JSON.stringify(payload) } });
        if (saved.count !== 1) continue;
      }
      // Rendering/persisting the body may overlap a cancellation or reschedule.
      // Recheck after that work, immediately before contacting the provider.
      if (!(await isCurrent(db, row.appointmentId, row.kind, payload, options.now ?? new Date()))) {
        await finish({ status: 'SKIPPED', lastError: null, payloadJson: '{}' });
        result.skipped++;
        continue;
      }
      await sendPreparedEmail(payload.email, row.eventKey);
      await db.$transaction(async (tx) => {
        const marked = await tx.notificationDelivery.updateMany({ where: { id: row.id, lockToken }, data: { status: 'SENT', sentAt: new Date(), lastError: null, lockedAt: null, lockToken: null, payloadJson: '{}' } });
        if (marked.count === 1 && row.appointmentId && ['REMINDER', 'REVIEW_REQUEST'].includes(row.kind)) {
          await tx.appointment.updateMany({ where: { id: row.appointmentId, date: new Date(payload.date), notificationVersion: payload.version }, data: row.kind === 'REMINDER' ? { reminderSent: true } : { reviewRequestSent: true } });
        }
      });
      result.sent++;
    } catch {
      const exhausted = row.attempts >= MAX_ATTEMPTS;
      await finish({ status: exhausted ? 'FAILED' : 'PENDING', nextAttemptAt: new Date(now.getTime() + Math.min(30 * 60_000, 60_000 * 2 ** Math.min(row.attempts, 10))), lastError: exhausted ? 'Delivery failed repeatedly. Check the email provider and sender configuration.' : 'Delivery failed. A retry is scheduled; check provider status and sender configuration.' });
      result.failed++;
    }
  }
  return result;
}

/** Only notification delivery failure is swallowed; transactional enqueue failure is not. */
export async function dispatchAppointmentNotifications(appointmentId: string) {
  try { return await dispatchPendingNotifications({ appointmentId, limit: 4, budgetMs: 30_000 }); }
  catch { console.error('Notification worker could not process the committed appointment. The scheduled worker will retry.'); }
}
