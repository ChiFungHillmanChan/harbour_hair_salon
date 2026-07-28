// src/app/actions/payroll.ts
'use server';

import { z } from 'zod';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { runPayroll, updateAdjustment, finalizePayroll, reopenPayroll } from '@/app/services/payroll-service';

async function requireAdminSession() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return null;
  return session;
}

/** Matches the { error?, success? } convention RowActionButton consumes. */
type ActionResult = { error?: string; success?: boolean };

const payrollPeriodSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

const adjustmentSchema = z.object({
  lineId: z.string().min(1, 'Missing payroll line.'),
  // Zod 4's z.number() already rejects NaN/Infinity, which a hand-crafted
  // request could otherwise push into the Decimal column.
  amount: z.number().min(-1_000_000, 'Adjustment is out of range.').max(1_000_000, 'Adjustment is out of range.'),
  note: z.string().max(500, 'Note is too long.'),
});

export async function runPayrollAction(year: number, month: number): Promise<ActionResult> {
  if (!(await requireAdminSession())) return { error: 'Unauthorized' };

  const parsed = payrollPeriodSchema.safeParse({ year, month });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid payroll period.' };
  }

  try {
    await runPayroll(parsed.data.year, parsed.data.month);
  } catch (e) {
    // runPayroll throws on a finalized period. Surfacing the message beats an
    // unhandled server-action rejection, which reaches the admin as a blank digest.
    return { error: e instanceof Error ? e.message : 'Could not run payroll.' };
  }
  revalidatePath('/admin/payroll');
  return { success: true };
}

export async function updateAdjustmentAction(lineId: string, amount: number, note: string): Promise<ActionResult> {
  if (!(await requireAdminSession())) return { error: 'Unauthorized' };

  const parsed = adjustmentSchema.safeParse({ lineId, amount, note });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid adjustment.' };
  }

  const result = await updateAdjustment(parsed.data.lineId, parsed.data.amount, parsed.data.note);
  if (result.error) return result;
  revalidatePath('/admin/payroll');
  return { success: true };
}

export async function finalizePayrollAction(periodId: string): Promise<ActionResult> {
  const session = await requireAdminSession();
  if (!session) return { error: 'Unauthorized' };
  const result = await finalizePayroll(periodId, session.userId);
  if (result.error) return result;
  revalidatePath('/admin/payroll');
  return { success: true };
}

export async function reopenPayrollAction(periodId: string): Promise<ActionResult> {
  if (!(await requireAdminSession())) return { error: 'Unauthorized' };
  const result = await reopenPayroll(periodId);
  if (result.error) return result;
  revalidatePath('/admin/payroll');
  return { success: true };
}
