'use server';

import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { isValidPin, hashPin } from '@/app/lib/pin';
import { z } from 'zod';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'Unauthorized', session: null };
  return { error: null, session };
}

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
  stylistId: z.string().nullable().optional(),
});

function parseEmployeeForm(formData: FormData) {
  return employeeSchema.safeParse({
    name: formData.get('name'),
    title: formData.get('title'),
    payType: formData.get('payType'),
    hourlyRate: formData.get('hourlyRate') || null,
    monthlySalary: formData.get('monthlySalary') || null,
    commissionRate: formData.get('commissionRate') || null,
    overtimeEnabled: formData.get('overtimeEnabled') === 'on',
    overtimeThresholdHours: formData.get('overtimeThresholdHours') || null,
    overtimeMultiplier: formData.get('overtimeMultiplier') || null,
    stylistId: (formData.get('stylistId') as string) || null,
  });
}

export async function createEmployee(formData: FormData) {
  const { error } = await requireAdmin();
  if (error) return { error };

  const parsed = parseEmployeeForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const pin = String(formData.get('pin') ?? '');
  if (!isValidPin(pin)) return { error: 'PIN must be 4–6 digits' };

  const d = parsed.data;
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
      stylistId: d.stylistId || null,
    },
  });

  revalidatePath('/admin/employees');
}

export async function updateEmployee(id: string, formData: FormData) {
  const { error } = await requireAdmin();
  if (error) return { error };

  const parsed = parseEmployeeForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const d = parsed.data;
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
      stylistId: d.stylistId || null,
    },
  });

  revalidatePath('/admin/employees');
}

export async function setEmployeePin(id: string, pin: string) {
  const { error } = await requireAdmin();
  if (error) return { error };
  if (!isValidPin(pin)) return { error: 'PIN must be 4–6 digits' };

  await prisma.employee.update({ where: { id }, data: { pinHash: await hashPin(pin) } });
  revalidatePath('/admin/employees');
  return { success: true };
}

export async function setEmployeeActive(id: string, isActive: boolean) {
  const { error } = await requireAdmin();
  if (error) return;
  await prisma.employee.update({ where: { id }, data: { isActive } });
  revalidatePath('/admin/employees');
}
