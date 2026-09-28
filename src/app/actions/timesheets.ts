'use server';

import prisma from '@/app/lib/prisma';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { auditedWrite } from '@/app/lib/audited-write';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { resolveSalonDateTime, isValidSalonDate, isValidSalonTime, SALON_TIMEZONE } from '@/app/services/salon-time';
import { fromZonedTime } from 'date-fns-tz';
import { z } from 'zod';
import { getActionT } from '@/i18n/request';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'UNAUTHORIZED', session: null };
  return { error: null, session };
}

/** Matches the { error?, success? } convention RowActionButton consumes. */
type ActionResult = { error?: string; success?: boolean };

/** An error message in the admin's language, addressed by a stable code. */
async function timesheetError(code: string): Promise<string> {
  const t = await getActionT('adminStaff');
  return t.dynamic(`timesheets.errors.${code}`, undefined, t('timesheets.errors.INVALID'));
}

const editSchema = z.object({
  date: z.string().refine(isValidSalonDate, 'DATE_INVALID'),
  clockInTime: z.string().refine(isValidSalonTime, 'CLOCK_IN_INVALID'),
  clockOutTime: z.string().refine((t) => t === '' || isValidSalonTime(t), 'CLOCK_OUT_INVALID'),
  breakMinutes: z.coerce.number('BREAK_INVALID').int('BREAK_INVALID').min(0, 'BREAK_INVALID').max(1440, 'BREAK_INVALID'),
  note: z.string().max(500, 'NOTE_TOO_LONG').optional(),
});

export async function updateTimeEntry(id: string, formData: FormData): Promise<ActionResult> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await timesheetError('UNAUTHORIZED') };

  const parsed = editSchema.safeParse({
    date: formData.get('date'),
    clockInTime: formData.get('clockInTime'),
    clockOutTime: formData.get('clockOutTime') ?? '',
    breakMinutes: formData.get('breakMinutes') ?? 0,
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { error: await timesheetError(parsed.error.issues[0]?.message ?? 'INVALID') };
  const d = parsed.data;

  const clockIn = resolveSalonDateTime(d.date, d.clockInTime).utc;
  const clockOut = d.clockOutTime ? resolveSalonDateTime(d.date, d.clockOutTime).utc : null;
  if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
    return { error: await timesheetError('CLOCK_OUT_BEFORE_IN') };
  }

  const updated = await auditedWrite({ actorUserId: session.userId, action: 'TIME_ENTRY.UPDATE', targetType: 'TimeEntry', targetId: id }, async (tx) => tx.timeEntry.updateMany({
    where: { id },
    data: {
      clockIn,
      clockOut,
      breakMinutes: d.breakMinutes,
      note: d.note || null,
      status: 'EDITED',
      editedByAdminId: session.userId,
    },
  }));
  if (updated.count === 0) return { error: await timesheetError('NOT_FOUND') };
  revalidateAllLocales(revalidatePath, '/admin/timesheets');
  return { success: true };
}

export async function approveTimeEntry(id: string): Promise<ActionResult> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await timesheetError('UNAUTHORIZED') };
  const entry = await prisma.timeEntry.findUnique({ where: { id }, select: { clockOut: true, updatedAt: true } });
  if (!entry) return { error: await timesheetError('NOT_FOUND') };
  if (!entry.clockOut) return { error: await timesheetError('STILL_OPEN') };
  // Approve only the closed revision we checked, never a concurrent edit or
  // reopened shift. The audit helper skips recording a failed conditional write.
  const approved = await auditedWrite({ actorUserId: session.userId, action: 'TIME_ENTRY.APPROVE', targetType: 'TimeEntry', targetId: id }, async (tx) => tx.timeEntry.updateMany({
    where: { id, updatedAt: entry.updatedAt, clockOut: { not: null } },
    data: { status: 'APPROVED' },
  }));
  if (approved.count !== 1) return { error: await timesheetError('CHANGED') };
  revalidateAllLocales(revalidatePath, '/admin/timesheets');
  return { success: true };
}

/**
 * Reverses an approval. Sends the entry back to EDITED (not PENDING) so it reads
 * as "an admin touched this" and lands in the same needs-approval bucket that
 * approveMonth picks up. Written as an updateMany so the APPROVED precondition
 * and the write are one atomic statement.
 */
export async function unapproveTimeEntry(id: string): Promise<ActionResult> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await timesheetError('UNAUTHORIZED') };
  const res = await auditedWrite({ actorUserId: session.userId, action: 'TIME_ENTRY.UNAPPROVE', targetType: 'TimeEntry', targetId: id }, async (tx) => tx.timeEntry.updateMany({
    where: { id, status: 'APPROVED' },
    data: { status: 'EDITED', editedByAdminId: session.userId },
  }));
  if (res.count === 0) return { error: await timesheetError('NOT_APPROVED') };
  revalidateAllLocales(revalidatePath, '/admin/timesheets');
  return { success: true };
}

export async function approveMonth(year: number, month: number): Promise<{ error?: string; count?: number }> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await timesheetError('UNAUTHORIZED') };
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { error: await timesheetError('INVALID_MONTH') };
  }
  const start = fromZonedTime(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const end = fromZonedTime(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const res = await auditedWrite({ actorUserId: session.userId, action: 'TIME_ENTRY.APPROVE_MONTH', targetType: 'TimeEntry', metadata: { year, month } }, async (tx) => tx.timeEntry.updateMany({
    where: { clockIn: { gte: start, lt: end }, clockOut: { not: null }, status: { in: ['PENDING', 'EDITED'] } },
    data: { status: 'APPROVED' },
  }));
  revalidateAllLocales(revalidatePath, '/admin/timesheets');
  return { count: res.count };
}

export async function deleteTimeEntry(id: string): Promise<ActionResult> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await timesheetError('UNAUTHORIZED') };
  const res = await auditedWrite({ actorUserId: session.userId, action: 'TIME_ENTRY.DELETE', targetType: 'TimeEntry', targetId: id }, async (tx) => tx.timeEntry.deleteMany({ where: { id } }));
  if (res.count === 0) return { error: await timesheetError('ALREADY_REMOVED') };
  revalidateAllLocales(revalidatePath, '/admin/timesheets');
  return { success: true };
}
