import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import prisma from '@/app/lib/prisma';
import { sendAppointmentReminder, sendReviewRequest } from '@/app/services/email-service';

// Up to 200 sequential email sends per run — give the function room on Vercel.
export const maxDuration = 60;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

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

  const now = new Date();
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      reminderSent: false,
      date: {
        gt: now,
        lte: twentyFourHoursFromNow,
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

  for (const appointment of appointments) {
    try {
      await sendAppointmentReminder({
        id: appointment.id,
        date: appointment.date,
        user: appointment.user,
        stylist: appointment.stylist,
        service: { ...appointment.service, price: Number(appointment.service.price) },
      });
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
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const pastAppointments = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
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

  for (const appointment of pastAppointments) {
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
      total: appointments.length,
    },
    reviewRequests: {
      sent: reviewSentIds.length,
      failed: reviewFailedIds.length,
      total: pastAppointments.length,
    },
  });
}
