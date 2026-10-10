import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/app/lib/prisma';
import { enqueueAppointmentNotification, dispatchPendingNotifications } from './notification-outbox-service';
import { lapseExpiredRescheduleRequests } from './reschedule-request-lapse';
import { reminderWindowEnd, reviewWindow } from '@/app/api/cron/reminders/reminder-window';

type EnqueueCursors = { REMINDER: string | null; REVIEW_REQUEST: string | null };

function readEnqueueCursors(json: string | null | undefined): EnqueueCursors {
  try {
    const saved = JSON.parse(json ?? '{}').enqueueCursors;
    return {
      REMINDER: typeof saved?.REMINDER === 'string' ? saved.REMINDER : null,
      REVIEW_REQUEST: typeof saved?.REVIEW_REQUEST === 'string' ? saved.REVIEW_REQUEST : null,
    };
  } catch {
    return { REMINDER: null, REVIEW_REQUEST: null };
  }
}

/** One bounded, observable worker is shared by the daily and retry schedules. */
export async function runNotificationCron(name: 'notifications' | 'reminders') {
  const now = new Date();
  const started = Date.now();
  const lockToken = randomUUID();
  const workerName = 'notification-worker';
  await prisma.backgroundJobState.upsert({ where: { name: workerName }, create: { name: workerName }, update: {} });
  const claim = await prisma.backgroundJobState.updateMany({ where: { name: workerName, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + 2 * 60_000), lockToken, lastStartedAt: now } });
  if (claim.count !== 1) {
    // Both schedules fire together at 08:00 UTC to share one Neon wake. The
    // other run is already doing this work, so this schedule ran normally;
    // record it, or Admin -> Operations shows this row as stuck for days.
    const busy = { busy: true, sharedWorker: workerName };
    await prisma.backgroundJobState.upsert({
      where: { name },
      create: { name, lastStartedAt: now, lastSucceededAt: now, lastResultJson: JSON.stringify(busy) },
      update: { lastStartedAt: now, lastSucceededAt: now, lastError: null, lastResultJson: JSON.stringify(busy) },
    });
    return { busy: true, failed: 0 };
  }
  let enqueueCursors: EnqueueCursors | undefined;
  try {
    await prisma.backgroundJobState.upsert({ where: { name }, create: { name, lastStartedAt: now }, update: { lastStartedAt: now } });
    const worker = await prisma.backgroundJobState.findUnique({ where: { name: workerName }, select: { lastResultJson: true } });
    enqueueCursors = readEnqueueCursors(worker?.lastResultJson);
    // Requests nobody answered in time: clear them and queue one email each
    // before this run's dispatch, so the email goes out in the same tick.
    // A failing lapse must never block reminders, review requests or delivery.
    let lapse = { lapsed: 0, failed: 0 };
    try {
      lapse = await lapseExpiredRescheduleRequests(now);
    } catch (error) {
      console.error('Reschedule-request lapse step failed:', error instanceof Error ? error.name : 'unknown');
      lapse = { lapsed: 0, failed: 1 };
    }
    const { start, end } = reviewWindow(now);
    let queued = 0;
    let scanned = 0;
    let deferred = 0;
    for (const kind of ['REMINDER', 'REVIEW_REQUEST'] as const) {
      // Give upcoming reminders their own batch, then reviews their own budget.
      // Persist the last scanned id across BOTH schedules so failed/previously
      // queued events cannot trap every run behind the same 100 appointments.
      const due: Prisma.AppointmentWhereInput = kind === 'REMINDER'
        ? { status: 'CONFIRMED', reminderSent: false, date: { gt: now, lte: reminderWindowEnd(now) } }
        : { status: { in: ['CONFIRMED', 'COMPLETED'] }, reviewRequestSent: false, review: null, date: { gte: start, lte: end } };
      const appointments = await prisma.appointment.findMany({
        where: { ...due, ...(enqueueCursors[kind] ? { id: { gt: enqueueCursors[kind]! } } : {}) },
        include: {
          user: { select: { email: true, name: true, phone: true } },
          stylist: { select: { name: true } },
          service: { select: { name: true, price: true, duration: true } },
          notifications: { where: { kind }, select: { eventKey: true } },
        },
        orderBy: { id: 'asc' },
        take: 100,
      });
      let processed = 0;
      const phaseBudget = kind === 'REMINDER' ? 5_000 : 10_000;
      for (const appointment of appointments) {
        if (Date.now() - started > phaseBudget) break;
        const eventKey = `appointment/${appointment.id}/${appointment.notificationVersion}/${kind}`;
        if (!appointment.notifications.some((notification) => notification.eventKey === eventKey)) {
          // Walk-in placeholder addresses queue nothing (and are rescanned
          // every run), so count only rows that were actually written.
          if (await enqueueAppointmentNotification(prisma, kind, appointment)) queued++;
        }
        enqueueCursors[kind] = appointment.id;
        processed++;
        scanned++;
      }
      deferred += appointments.length - processed;
      if (processed === appointments.length && appointments.length < 100) enqueueCursors[kind] = null;
    }
    // Newly inserted rows become due after discovery began; use a fresh cutoff.
    const delivery = await dispatchPendingNotifications({ budgetMs: Math.max(0, 45_000 - (Date.now() - started)), limit: 30 });
    const result = { queued, scanned, lapsed: lapse.lapsed, lapseFailed: lapse.failed, ...delivery, deferred: delivery.deferred + deferred, durationMs: Date.now() - started };
    await prisma.backgroundJobState.update({ where: { name }, data: {
      ...(delivery.failed ? { lastFailedAt: new Date(), lastError: 'Some notifications failed; inspect the notification queue.' } : { lastSucceededAt: new Date(), lastError: null }),
      lastResultJson: JSON.stringify(result),
    } });
    return result;
  } catch {
    await prisma.backgroundJobState.update({ where: { name }, data: { lastFailedAt: new Date(), lastError: 'Notification worker failed. Check database and provider configuration.' } });
    throw new Error('Notification worker failed');
  } finally {
    await prisma.backgroundJobState.updateMany({ where: { name: workerName, lockToken }, data: {
      lockedUntil: null,
      lockToken: null,
      ...(enqueueCursors ? { lastResultJson: JSON.stringify({ enqueueCursors }) } : {}),
    } });
  }
}
