import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';
import { sendAppointmentReminder } from '@/app/services/email-service';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      reminderSent: false,
      date: {
        gte: now,
        lte: twentyFourHoursFromNow,
      },
    },
    include: {
      user: true,
      stylist: true,
      service: true,
    },
  });

  let sent = 0;
  for (const appointment of appointments) {
    try {
      await sendAppointmentReminder({
        id: appointment.id,
        date: appointment.date,
        user: appointment.user,
        stylist: appointment.stylist,
        service: { ...appointment.service, price: Number(appointment.service.price) },
      });
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { reminderSent: true },
      });
      sent++;
    } catch (error) {
      console.error(`Failed to send reminder for appointment ${appointment.id}:`, error);
    }
  }

  return NextResponse.json({ sent, total: appointments.length });
}
