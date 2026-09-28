'use server';

import { auditedWrite } from '@/app/lib/audited-write';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { isValidPin, hashPin } from '@/app/lib/pin';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getActionT } from '@/i18n/request';

export type EmployeeActionState = { error?: string; success?: boolean };

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'UNAUTHORIZED', session: null };
  return { error: null, session };
}

/** An error message in the admin's language, addressed by a stable code. */
async function employeeError(code: string): Promise<EmployeeActionState> {
  const t = await getActionT('adminStaff');
  return { error: t.dynamic(`employees.errors.${code}`, undefined, t('employees.errors.INVALID')) };
}

/** Our own schema codes translate directly; any other rule names the field. */
async function validationError(issue: { message: string; path: PropertyKey[] } | undefined): Promise<EmployeeActionState> {
  const t = await getActionT('adminStaff');
  const code = issue?.message ?? '';
  if (/^[A-Z_]+$/.test(code) && t.has(`employees.errors.${code}`)) return { error: t.dynamic(`employees.errors.${code}`) };
  const field = String(issue?.path[0] ?? '');
  return t.has(`employees.fields.${field}`)
    ? { error: t('employees.errors.INVALID_FIELD', { field: t.dynamic(`employees.fields.${field}`) }) }
    : { error: t('employees.errors.INVALID') };
}

const PAY_TYPES = ['HOURLY', 'SALARY', 'COMMISSION', 'HYBRID'] as const;

const employeeSchema = z.object({
  name: z.string().min(2, 'NAME_TOO_SHORT').max(100, 'NAME_TOO_LONG'),
  title: z.string().min(1, 'TITLE_REQUIRED').max(100, 'TITLE_TOO_LONG'),
  payType: z.enum(PAY_TYPES),
  hourlyRate: z.coerce.number().nonnegative().nullable().optional(),
  monthlySalary: z.coerce.number().nonnegative().nullable().optional(),
  commissionRate: z.coerce.number().min(0, 'COMMISSION_RANGE').max(1, 'COMMISSION_RANGE').nullable().optional(),
  overtimeEnabled: z.boolean().optional(),
  overtimeThresholdHours: z.coerce.number().nonnegative().nullable().optional(),
  overtimeMultiplier: z.coerce.number().min(1).nullable().optional(),
  unpaidBreakMinutes: z.coerce.number().int().min(0).max(480).nullable().optional(),
  stylistId: z.string().nullable().optional(),
});

function parseEmployeeForm(formData: FormData) {
  return employeeSchema.safeParse({
    name: formData.get('name'),
    title: formData.get('title'),
    payType: formData.get('payType'),
    hourlyRate: (formData.get('hourlyRate') && Number(formData.get('hourlyRate')) > 0) ? formData.get('hourlyRate') : null,
    monthlySalary: formData.get('monthlySalary') || null,
    commissionRate: formData.get('commissionRate') || null,
    overtimeEnabled: formData.get('overtimeEnabled') === 'on',
    overtimeThresholdHours: formData.get('overtimeThresholdHours') || null,
    overtimeMultiplier: formData.get('overtimeMultiplier') || null,
    unpaidBreakMinutes: formData.get('unpaidBreakMinutes') || null,
    stylistId: (formData.get('stylistId') as string) || null,
  });
}

export async function createEmployee(formData: FormData): Promise<EmployeeActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return employeeError('UNAUTHORIZED');

  const parsed = parseEmployeeForm(formData);
  if (!parsed.success) return validationError(parsed.error.issues[0]);

  const pin = String(formData.get('pin') ?? '');
  if (!isValidPin(pin)) return employeeError('PIN_INVALID');

  const d = parsed.data;
  try {
    await auditedWrite({ actorUserId: session.userId, action: 'EMPLOYEE.CREATE', targetType: 'Employee' }, async (tx) => tx.employee.create({
      data: {
        name: d.name,
        title: d.title,
        pinHash: await hashPin(pin),
        payType: d.payType,
        hourlyRate: d.hourlyRate ?? null,
        monthlySalary: d.monthlySalary ?? null,
        commissionRate: d.commissionRate ?? null,
        overtimeEnabled: d.overtimeEnabled ?? false,
        overtimeThresholdHours: d.overtimeThresholdHours ?? null,
        overtimeMultiplier: d.overtimeMultiplier ?? null,
        unpaidBreakMinutes: d.unpaidBreakMinutes ?? null,
        stylistId: d.stylistId || null,
      },
    }));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return employeeError('STYLIST_TAKEN');
    }
    console.error('createEmployee failed:', err);
    return employeeError('CREATE_FAILED');
  }

  revalidateAllLocales(revalidatePath, '/admin/employees');
  return { success: true };
}

export async function updateEmployee(id: string, formData: FormData): Promise<EmployeeActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return employeeError('UNAUTHORIZED');

  const parsed = parseEmployeeForm(formData);
  if (!parsed.success) return validationError(parsed.error.issues[0]);

  const d = parsed.data;
  try {
    await auditedWrite({ actorUserId: session.userId, action: 'EMPLOYEE.UPDATE', targetType: 'Employee', targetId: id }, async (tx) => tx.employee.update({
      where: { id },
      data: {
        name: d.name,
        title: d.title,
        payType: d.payType,
        hourlyRate: d.hourlyRate ?? null,
        monthlySalary: d.monthlySalary ?? null,
        commissionRate: d.commissionRate ?? null,
        overtimeEnabled: d.overtimeEnabled ?? false,
        overtimeThresholdHours: d.overtimeThresholdHours ?? null,
        overtimeMultiplier: d.overtimeMultiplier ?? null,
        unpaidBreakMinutes: d.unpaidBreakMinutes ?? null,
        stylistId: d.stylistId || null,
      },
    }));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return employeeError('STYLIST_TAKEN');
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return employeeError('NOT_FOUND');
    }
    console.error('updateEmployee failed:', err);
    return employeeError('SAVE_FAILED');
  }

  revalidateAllLocales(revalidatePath, '/admin/employees');
  revalidateAllLocales(revalidatePath, `/admin/employees/${id}/edit`);
  return { success: true };
}

export async function setEmployeePin(id: string, pin: string): Promise<EmployeeActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return employeeError('UNAUTHORIZED');
  if (!isValidPin(pin)) return employeeError('PIN_INVALID');

  try {
    await auditedWrite({ actorUserId: session.userId, action: 'EMPLOYEE.PIN_RESET', targetType: 'Employee', targetId: id }, async (tx) => tx.employee.update({ where: { id }, data: { pinHash: await hashPin(pin) } }));
  } catch (err) {
    console.error('setEmployeePin failed:', err);
    return employeeError('PIN_FAILED');
  }

  revalidateAllLocales(revalidatePath, '/admin/employees');
  return { success: true };
}

/** useActionState wrapper for the per-row "Reset PIN" form on /admin/employees. */
export async function resetEmployeePin(
  id: string,
  _prev: EmployeeActionState,
  formData: FormData
): Promise<EmployeeActionState> {
  return setEmployeePin(id, String(formData.get('pin') ?? ''));
}

export async function setEmployeeActive(id: string, isActive: boolean): Promise<EmployeeActionState> {
  const { error, session } = await requireAdmin();
  if (error || !session) return employeeError('UNAUTHORIZED');

  try {
    await auditedWrite({ actorUserId: session.userId, action: 'EMPLOYEE.STATUS', targetType: 'Employee', targetId: id }, async (tx) => tx.employee.update({ where: { id }, data: { isActive } }));
  } catch (err) {
    console.error('setEmployeeActive failed:', err);
    return employeeError('STATUS_FAILED');
  }

  revalidateAllLocales(revalidatePath, '/admin/employees');
  return { success: true };
}
