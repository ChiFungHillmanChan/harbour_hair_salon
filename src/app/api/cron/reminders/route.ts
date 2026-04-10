import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import prisma from '@/app/lib/prisma';
import { sendAppointmentReminder } from '@/app/services/email-service';

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
      sentIds.push(appointment.id);
    } catch (error) {
      console.error(`Failed to send reminder for appointment ${appointment.id}:`, error);
      failedIds.push(appointment.id);
    }
  }

  // Batch update all successfully sent reminders
  if (sentIds.length > 0) {
    await prisma.appointment.updateMany({
      where: { id: { in: sentIds } },
      data: { reminderSent: true },
    });
  }

  return NextResponse.json({ sent: sentIds.length, failed: failedIds.length, total: appointments.length });
}
