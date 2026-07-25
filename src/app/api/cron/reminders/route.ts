import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';
import { sendAppointmentReminder, sendReviewRequest } from '@/app/services/email-service';
import { safeCompare, reminderWindowEnd, reviewWindow, hasSendBudgetLeft } from './reminder-window';

// Queues up to 200 sequential email sends per run — give the function room on
// Vercel. Actual work is capped by SEND_BUDGET_MS (45s) so the handler always
// returns a report instead of being killed mid-send; anything not reached is
// deferred to the next daily run.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET is not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const now = new Date();
  // 36h (not 24h) so a send that fails today is retried on tomorrow's run while
  // still within the window (the cron only runs once per day).
  const thirtySixHoursFromNow = reminderWindowEnd(now);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      reminderSent: false,
      date: {
        gt: now,
        lte: thirtySixHoursFromNow,
      },
    },
    include: {
      user: { select: { email: true, name: true } },
      stylist: { select: { name: true } },
      service: { select: { name: true, price: true, duration: true } },
    },
    orderBy: { date: 'asc' },
    take: 100, // bound work per run so a backlog can't time out the function
  });

  const sentIds: string[] = [];
  const failedIds: string[] = [];
  let deferredReminders = 0;

  for (const appointment of appointments) {
    // Stop before the function is killed mid-send. Every row is marked sent as
    // soon as it succeeds, so the remainder is simply picked up tomorrow.
    if (!hasSendBudgetLeft(startedAt, Date.now())) {
      deferredReminders = appointments.length - (sentIds.length + failedIds.length);
      console.warn(`Reminder send budget exhausted — deferring ${deferredReminders} reminder(s) to the next run.`);
      break;
    }
    try {
      try {
        await sendAppointmentReminder({
          id: appointment.id,
          date: appointment.date,
          user: appointment.user,
          stylist: appointment.stylist,
          service: { ...appointment.service, price: Number(appointment.service.price) },
        });
      } catch (firstErr) {
        console.error(`Reminder send failed once for ${appointment.id}, retrying:`, firstErr);
        await sendAppointmentReminder({
          id: appointment.id,
          date: appointment.date,
          user: appointment.user,
          stylist: appointment.stylist,
          service: { ...appointment.service, price: Number(appointment.service.price) },
        });
      }
      // Mark sent immediately so a mid-run timeout never re-sends this reminder.
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { reminderSent: true },
      });
      sentIds.push(appointment.id);
    } catch (error) {
      console.error(`Failed to send reminder for appointment ${appointment.id}:`, error);
      failedIds.push(appointment.id);
    }
  }

  // Review request emails: past appointments from 1-14 days ago without a review
  // or an already-sent request. Two-week cutoff keeps the flywheel fresh, not spammy.
  const { start: fourteenDaysAgo, end: oneDayAgo } = reviewWindow(now);

  const pastAppointments = await prisma.appointment.findMany({
    where: {
      status: { in: ['CONFIRMED', 'COMPLETED'] },
      reviewRequestSent: false,
      date: {
        gte: fourteenDaysAgo,
        lte: oneDayAgo,
      },
      review: null,
    },
    include: {
      user: { select: { email: true, name: true } },
      stylist: { select: { name: true } },
      service: { select: { name: true } },
    },
    take: 100,
  });

  const reviewSentIds: string[] = [];
  const reviewFailedIds: string[] = [];
  let deferredReviews = 0;

  for (const appointment of pastAppointments) {
    if (!hasSendBudgetLeft(startedAt, Date.now())) {
      deferredReviews = pastAppointments.length - (reviewSentIds.length + reviewFailedIds.length);
      console.warn(`Review-request send budget exhausted — deferring ${deferredReviews} request(s) to the next run.`);
      break;
    }
    try {
      await sendReviewRequest({
        id: appointment.id,
        date: appointment.date,
        user: appointment.user,
        stylist: appointment.stylist,
        service: appointment.service,
      });
      // Mark sent immediately (like reminders) so a mid-run timeout never
      // re-sends an already-delivered review request on the next run.
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { reviewRequestSent: true },
      });
      reviewSentIds.push(appointment.id);
    } catch (error) {
      console.error(`Failed to send review request for appointment ${appointment.id}:`, error);
      reviewFailedIds.push(appointment.id);
    }
  }

  return NextResponse.json({
    reminders: {
      sent: sentIds.length,
      failed: failedIds.length,
      deferred: deferredReminders,
      total: appointments.length,
    },
    reviewRequests: {
      sent: reviewSentIds.length,
      failed: reviewFailedIds.length,
      deferred: deferredReviews,
      total: pastAppointments.length,
    },
    durationMs: Date.now() - startedAt,
  });
}
