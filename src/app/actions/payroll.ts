// src/app/actions/payroll.ts
'use server';

import { z } from 'zod';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { runPayroll, updateAdjustment, finalizePayroll } from '@/app/services/payroll-service';

async function requireAdminSession() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return null;
  return session;
}

const payrollPeriodSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

export async function runPayrollAction(year: number, month: number) {
  if (!(await requireAdminSession())) return;

  const parsed = payrollPeriodSchema.safeParse({ year, month });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid payroll period.' };
  }

  await runPayroll(parsed.data.year, parsed.data.month);
  revalidatePath('/admin/payroll');
}

export async function updateAdjustmentAction(lineId: string, amount: number, note: string) {
  if (!(await requireAdminSession())) return;
  await updateAdjustment(lineId, amount, note);
  revalidatePath('/admin/payroll');
}

export async function finalizePayrollAction(periodId: string) {
  const session = await requireAdminSession();
  if (!session) return;
  await finalizePayroll(periodId, session.userId);
  revalidatePath('/admin/payroll');
}
