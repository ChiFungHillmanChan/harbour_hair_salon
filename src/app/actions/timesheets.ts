'use server';

import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { resolveSalonDateTime, isValidSalonDate, isValidSalonTime, SALON_TIMEZONE } from '@/app/services/salon-time';
import { fromZonedTime } from 'date-fns-tz';
import { z } from 'zod';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'Unauthorized', session: null };
  return { error: null, session };
}

const editSchema = z.object({
  date: z.string().refine(isValidSalonDate, 'Invalid date'),
  clockInTime: z.string().refine(isValidSalonTime, 'Invalid clock-in time'),
  clockOutTime: z.string().refine((t) => t === '' || isValidSalonTime(t), 'Invalid clock-out time'),
  breakMinutes: z.coerce.number().int().min(0).max(1440),
  note: z.string().max(500).optional(),
});

export async function updateTimeEntry(id: string, formData: FormData) {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: error ?? 'Unauthorized' };

  const parsed = editSchema.safeParse({
    date: formData.get('date'),
    clockInTime: formData.get('clockInTime'),
    clockOutTime: formData.get('clockOutTime') ?? '',
    breakMinutes: formData.get('breakMinutes') ?? 0,
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const clockIn = resolveSalonDateTime(d.date, d.clockInTime).utc;
  const clockOut = d.clockOutTime ? resolveSalonDateTime(d.date, d.clockOutTime).utc : null;
  if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
    return { error: 'Clock-out must be after clock-in' };
  }

  await prisma.timeEntry.update({
    where: { id },
    data: {
      clockIn,
      clockOut,
      breakMinutes: d.breakMinutes,
      note: d.note || null,
      status: 'EDITED',
      editedByAdminId: session.userId,
    },
  });
  revalidatePath('/admin/timesheets');
}

export async function approveTimeEntry(id: string) {
  const { error } = await requireAdmin();
  if (error) return;
  const entry = await prisma.timeEntry.findUnique({ where: { id } });
  if (!entry || !entry.clockOut) return; // cannot approve an open entry
  await prisma.timeEntry.update({ where: { id }, data: { status: 'APPROVED' } });
  revalidatePath('/admin/timesheets');
}

export async function approveMonth(year: number, month: number) {
  const { error } = await requireAdmin();
  if (error) return { error };
  const start = fromZonedTime(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const end = fromZonedTime(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const res = await prisma.timeEntry.updateMany({
    where: { clockIn: { gte: start, lt: end }, clockOut: { not: null }, status: { in: ['PENDING', 'EDITED'] } },
    data: { status: 'APPROVED' },
  });
  revalidatePath('/admin/timesheets');
  return { count: res.count };
}

export async function deleteTimeEntry(id: string) {
  const { error } = await requireAdmin();
  if (error) return;
  await prisma.timeEntry.delete({ where: { id } });
  revalidatePath('/admin/timesheets');
}
