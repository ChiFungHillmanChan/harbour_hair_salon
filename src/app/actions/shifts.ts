'use server';

import { auditedWrite } from '@/app/lib/audited-write';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { isValidSalonDate, isValidSalonTime } from '@/app/services/salon-time';
import { z } from 'zod';
import { getActionT } from '@/i18n/request';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'UNAUTHORIZED', session: null };
  return { error: null, session };
}

/** An error message in the admin's language, addressed by a stable code. */
async function shiftError(code: string): Promise<string> {
  const t = await getActionT('adminStaff');
  return t.dynamic(`shifts.errors.${code}`, undefined, t('shifts.errors.INVALID'));
}

// Messages are codes, translated by shiftError. A missing field (null) fails
// the string check itself and falls back to the generic message.
const shiftSchema = z
  .object({
    employeeId: z.string().min(1, 'EMPLOYEE_REQUIRED'),
    date: z.string().refine(isValidSalonDate, 'DATE_INVALID'),
    startTime: z.string().refine(isValidSalonTime, 'START_INVALID'),
    endTime: z.string().refine(isValidSalonTime, 'END_INVALID'),
  })
  .refine((d) => d.endTime > d.startTime, { message: 'END_BEFORE_START', path: ['endTime'] });

export async function createShift(_prevState: unknown, formData: FormData): Promise<{ error: string | null }> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await shiftError('UNAUTHORIZED') };
  const parsed = shiftSchema.safeParse({
    employeeId: formData.get('employeeId'),
    date: formData.get('date'),
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
  });
  if (!parsed.success) return { error: await shiftError(parsed.error.issues[0]?.message ?? 'INVALID') };
  const d = parsed.data;
  await auditedWrite({ actorUserId: session.userId, action: 'SHIFT.CREATE', targetType: 'Shift' }, async (tx) => tx.shift.create({
    data: {
      employeeId: d.employeeId,
      date: new Date(`${d.date}T00:00:00.000Z`),
      startTime: d.startTime,
      endTime: d.endTime,
    },
  }));
  revalidateAllLocales(revalidatePath, '/admin/shifts');
  return { error: null };
}

export async function deleteShift(id: string): Promise<{ error?: string; success?: boolean }> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: await shiftError('UNAUTHORIZED') };
  // deleteMany, not delete: a second submission of the same row (double click,
  // stale tab) would otherwise throw an unhandled P2025 instead of no-opping.
  await auditedWrite({ actorUserId: session.userId, action: 'SHIFT.DELETE', targetType: 'Shift', targetId: id }, async (tx) => tx.shift.deleteMany({ where: { id } }));
  revalidateAllLocales(revalidatePath, '/admin/shifts');
  return { success: true };
}
