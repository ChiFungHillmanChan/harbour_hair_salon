import 'server-only';
import type { Prisma } from '@prisma/client';
import { isRequestLapseNoticeTimely } from '@/app/lib/appointment-timing';

/**
 * Whether closing a booking request unanswered should send the customer the
 * REQUEST_LAPSED email ("we couldn't confirm your request in time"): only when
 * they were told it was awaiting confirmation — its REQUEST_RECEIVED notice was
 * queued (a staff "pencil in" never has one, and that customer has often simply
 * come in) — and only within REQUEST_LAPSE_NOTICE_HOURS of the requested time.
 *
 * The one rule for both ways a request closes unanswered: the lapse step
 * (pending-request-lapse.ts) and staff declining it once its time has come
 * (actions/admin.ts updateAppointmentStatus). Call it inside the transaction
 * that closes the request.
 */
export async function isRequestLapseNoticeDue(
  db: Pick<Prisma.TransactionClient, 'notificationDelivery'>,
  request: { id: string; date: Date },
  now: Date,
): Promise<boolean> {
  if (!isRequestLapseNoticeTimely(request.date, now)) return false;
  const announced = await db.notificationDelivery.findFirst({
    where: { appointmentId: request.id, kind: 'REQUEST_RECEIVED' },
    select: { id: true },
  });
  return announced !== null;
}

/**
 * The salon phone for the REQUEST_LAPSED callout ("call us or book another
 * time"). Best effort: a failed read sends the email without the phone rather
 * than keeping the request open.
 */
export async function readSalonPhoneForLapseNotice(db: Pick<Prisma.TransactionClient, 'siteSettings'>): Promise<string | undefined> {
  try {
    const settings = await db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { phone: true } });
    return settings?.phone || undefined;
  } catch (error) {
    console.error('Reading the salon phone for request-lapse emails failed:', error instanceof Error ? error.name : 'unknown');
    return undefined;
  }
}
