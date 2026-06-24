// src/app/actions/payroll.ts
'use server';

import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { runPayroll, updateAdjustment, finalizePayroll } from '@/app/services/payroll-service';

async function requireAdminSession() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return null;
  return session;
}

export async function runPayrollAction(year: number, month: number) {
  if (!(await requireAdminSession())) return;
  await runPayroll(year, month);
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
