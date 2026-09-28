// src/app/actions/payroll.ts
'use server';

import { z } from 'zod';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { runPayroll, updateAdjustment, finalizePayroll, reopenPayroll, PayrollFinalizedError, PayrollMissingPriceError, type PayrollMutationResult } from '@/app/services/payroll-service';
import { getActionT } from '@/i18n/request';
import { formatMonth, formatSalonDateTime } from '@/i18n/dates';

async function requireAdminSession() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return null;
  return session;
}

/** Matches the { error?, success? } convention RowActionButton consumes. */
type ActionResult = { error?: string; success?: boolean };

/** A refused run can list what needs fixing (one line per affected item). */
export type PayrollRunResult = ActionResult & { details?: string[] };

/** How many affected appointments are listed by date before summarising the rest. */
const MAX_LISTED = 20;

async function payrollError(code: string, fallback?: string): Promise<ActionResult> {
  const t = await getActionT('adminStaff');
  return { error: t.dynamic(`payroll.errors.${code}`, undefined, fallback ?? t('payroll.errors.RUN_FAILED')) };
}

/** Service refusals carry a stable `code`; their English text is only the fallback. */
async function fromService(result: PayrollMutationResult): Promise<ActionResult> {
  return result.code ? payrollError(result.code, result.error) : { error: result.error };
}

// Messages are codes, translated by payrollError.
const payrollPeriodSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

const adjustmentSchema = z.object({
  lineId: z.string().min(1, 'LINE_MISSING'),
  // Zod 4's z.number() already rejects NaN/Infinity, which a hand-crafted
  // request could otherwise push into the Decimal column.
  amount: z.number('ADJUSTMENT_RANGE').min(-1_000_000, 'ADJUSTMENT_RANGE').max(1_000_000, 'ADJUSTMENT_RANGE'),
  note: z.string().max(500, 'NOTE_TOO_LONG'),
});

export async function runPayrollAction(year: number, month: number): Promise<PayrollRunResult> {
  const session = await requireAdminSession();
  if (!session) return payrollError('UNAUTHORIZED');

  const parsed = payrollPeriodSchema.safeParse({ year, month });
  if (!parsed.success) return payrollError('INVALID_PERIOD');

  try {
    await runPayroll(parsed.data.year, parsed.data.month, session.userId);
  } catch (e) {
    // Commission for this month depends on appointments whose price was never
    // recorded. Nothing was written; say which bookings need an amount.
    if (e instanceof PayrollMissingPriceError) {
      const t = await getActionT('adminStaff');
      const listed = [...e.appointments]
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, MAX_LISTED)
        .map((appointment) => t('payroll.missingPrice.item', {
          date: formatSalonDateTime(t.locale, appointment.date),
          stylist: appointment.stylistName,
        }));
      const rest = e.appointments.length - listed.length;
      return {
        error: t('payroll.missingPrice.summary', { count: e.appointments.length }),
        details: rest > 0 ? [...listed, t('payroll.missingPrice.more', { count: rest })] : listed,
      };
    }
    if (e instanceof PayrollFinalizedError) {
      const t = await getActionT('adminStaff');
      return { error: t('payroll.errors.ALREADY_FINALIZED', { period: formatMonth(t.locale, parsed.data.year, parsed.data.month) }) };
    }
    // Surfacing a message beats an unhandled server-action rejection, which
    // reaches the admin as a blank digest.
    console.error('runPayrollAction failed:', e);
    return payrollError('RUN_FAILED');
  }
  revalidateAllLocales(revalidatePath, '/admin/payroll');
  return { success: true };
}

export async function updateAdjustmentAction(lineId: string, amount: number, note: string): Promise<ActionResult> {
  const session = await requireAdminSession();
  if (!session) return payrollError('UNAUTHORIZED');

  const parsed = adjustmentSchema.safeParse({ lineId, amount, note });
  if (!parsed.success) {
    const t = await getActionT('adminStaff');
    return { error: t.dynamic(`payroll.errors.${parsed.error.issues[0]?.message}`, undefined, t('payroll.errors.INVALID_ADJUSTMENT')) };
  }

  const result = await updateAdjustment(parsed.data.lineId, parsed.data.amount, parsed.data.note, session.userId);
  if (result.error) return fromService(result);
  revalidateAllLocales(revalidatePath, '/admin/payroll');
  return { success: true };
}

export async function finalizePayrollAction(periodId: string): Promise<ActionResult> {
  const session = await requireAdminSession();
  if (!session) return payrollError('UNAUTHORIZED');
  const result = await finalizePayroll(periodId, session.userId);
  if (result.error) return fromService(result);
  revalidateAllLocales(revalidatePath, '/admin/payroll');
  return { success: true };
}

export async function reopenPayrollAction(periodId: string): Promise<ActionResult> {
  const session = await requireAdminSession();
  if (!session) return payrollError('UNAUTHORIZED');
  const result = await reopenPayroll(periodId, session.userId);
  if (result.error) return fromService(result);
  revalidateAllLocales(revalidatePath, '/admin/payroll');
  return { success: true };
}
