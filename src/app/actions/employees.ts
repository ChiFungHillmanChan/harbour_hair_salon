'use server';

import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { isValidPin, hashPin } from '@/app/lib/pin';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

export type EmployeeActionState = { error?: string; success?: boolean };

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'Unauthorized', session: null };
  return { error: null, session };
}

const STYLIST_TAKEN = 'That stylist is already linked to another employee.';

const PAY_TYPES = ['HOURLY', 'SALARY', 'COMMISSION', 'HYBRID'] as const;

const employeeSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  title: z.string().min(1, 'Title is required').max(100),
  payType: z.enum(PAY_TYPES),
  hourlyRate: z.coerce.number().nonnegative().nullable().optional(),
  monthlySalary: z.coerce.number().nonnegative().nullable().optional(),
  commissionRate: z.coerce.number().min(0).max(1, 'Commission rate is a fraction 0–1').nullable().optional(),
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
  const { error } = await requireAdmin();
  if (error) return { error };

  const parsed = parseEmployeeForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const pin = String(formData.get('pin') ?? '');
  if (!isValidPin(pin)) return { error: 'PIN must be 4–6 digits' };

  const d = parsed.data;
  try {
    await prisma.employee.create({
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
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: STYLIST_TAKEN };
    }
    console.error('createEmployee failed:', err);
    return { error: 'Failed to add employee. Please try again.' };
  }

  revalidatePath('/admin/employees');
  return { success: true };
}

export async function updateEmployee(id: string, formData: FormData): Promise<EmployeeActionState> {
  const { error } = await requireAdmin();
  if (error) return { error };

  const parsed = parseEmployeeForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const d = parsed.data;
  try {
    await prisma.employee.update({
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
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: STYLIST_TAKEN };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return { error: 'That employee no longer exists.' };
    }
    console.error('updateEmployee failed:', err);
    return { error: 'Failed to save changes. Please try again.' };
  }

  revalidatePath('/admin/employees');
  revalidatePath(`/admin/employees/${id}/edit`);
  return { success: true };
}

export async function setEmployeePin(id: string, pin: string): Promise<EmployeeActionState> {
  const { error } = await requireAdmin();
  if (error) return { error };
  if (!isValidPin(pin)) return { error: 'PIN must be 4–6 digits' };

  try {
    await prisma.employee.update({ where: { id }, data: { pinHash: await hashPin(pin) } });
  } catch (err) {
    console.error('setEmployeePin failed:', err);
    return { error: 'Failed to set the PIN. Please try again.' };
  }

  revalidatePath('/admin/employees');
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
  const { error } = await requireAdmin();
  if (error) return { error };

  try {
    await prisma.employee.update({ where: { id }, data: { isActive } });
  } catch (err) {
    console.error('setEmployeeActive failed:', err);
    return { error: 'Failed to update status. Please try again.' };
  }

  revalidatePath('/admin/employees');
  return { success: true };
}
