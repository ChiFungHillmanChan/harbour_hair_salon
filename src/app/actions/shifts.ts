'use server';

import { auditedWrite } from '@/app/lib/audited-write';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { isValidSalonDate, isValidSalonTime } from '@/app/services/salon-time';
import { z } from 'zod';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'Unauthorized', session: null };
  return { error: null, session };
}

const shiftSchema = z
  .object({
    employeeId: z.string().min(1, 'Employee is required'),
    date: z.string().refine(isValidSalonDate, 'Invalid date'),
    startTime: z.string().refine(isValidSalonTime, 'Invalid start time'),
    endTime: z.string().refine(isValidSalonTime, 'Invalid end time'),
  })
  .refine((d) => d.endTime > d.startTime, { message: 'End time must be after start time', path: ['endTime'] });

export async function createShift(_prevState: unknown, formData: FormData): Promise<{ error: string | null }> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: error ?? 'Unauthorized' };
  const parsed = shiftSchema.safeParse({
    employeeId: formData.get('employeeId'),
    date: formData.get('date'),
    startTime: formData.get('startTime'),
    endTime: formData.get('endTime'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  await auditedWrite({ actorUserId: session.userId, action: 'SHIFT.CREATE', targetType: 'Shift' }, async (tx) => tx.shift.create({
    data: {
      employeeId: d.employeeId,
      date: new Date(`${d.date}T00:00:00.000Z`),
      startTime: d.startTime,
      endTime: d.endTime,
    },
  }));
  revalidatePath('/admin/shifts');
  return { error: null };
}

export async function deleteShift(id: string): Promise<{ error?: string; success?: boolean }> {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: error ?? 'Unauthorized' };
  // deleteMany, not delete: a second submission of the same row (double click,
  // stale tab) would otherwise throw an unhandled P2025 instead of no-opping.
  await auditedWrite({ actorUserId: session.userId, action: 'SHIFT.DELETE', targetType: 'Shift', targetId: id }, async (tx) => tx.shift.deleteMany({ where: { id } }));
  revalidatePath('/admin/shifts');
  return { success: true };
}
