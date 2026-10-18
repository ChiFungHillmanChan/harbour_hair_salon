import 'server-only';
import type { Prisma } from '@prisma/client';
import { isRequestLapseNoticeTimely } from '@/app/lib/appointment-timing';

/**
 * The salon alert every ONLINE request queues as it is made
 * (booking-service.ts createBooking / createBookingForFirstAvailable), at
 * notificationVersion 0 — the eventKey enqueueAppointmentNotification gives it.
 * A staff "pencil in" (admin-schedule.ts createAppointmentByAdmin) queues none
 * when it is made; moving one queues its alert at a later version (the move
 * bumps notificationVersion first), never this key. So it marks an online
 * request, with or without a card deposit, and never a pencil-in.
 */
export function onlineRequestAlertKey(appointmentId: string): string {
  return `appointment/${appointmentId}/0/SALON_ALERT`;
}

/**
 * Whether closing a booking request unanswered should send the customer the
 * REQUEST_LAPSED email ("we couldn't confirm your request in time"): only for a
 * request the customer sent online — they are waiting for an answer — never a
 * staff "pencil in" (that customer has often simply come in), and only within
 * REQUEST_LAPSE_NOTICE_HOURS of the requested time.
 *
 * An online request is known by its first salon alert (onlineRequestAlertKey).
 * Requests made before 2026-10-18 are also known by their REQUEST_RECEIVED
 * notice, the customer email that rule used to read; that email is retired
 * (RETIRED_CUSTOMER_EMAIL_KINDS), so new requests have none.
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
  const alerted = await db.notificationDelivery.findUnique({ where: { eventKey: onlineRequestAlertKey(request.id) }, select: { id: true } });
  if (alerted) return true;
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
