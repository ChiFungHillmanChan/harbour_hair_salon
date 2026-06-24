'use server';

import prisma from '@/app/lib/prisma';
import { verifySession, createKioskSession, deleteKioskSession, getKioskSession } from '@/app/lib/session';
import { verifyPin } from '@/app/lib/pin';
import { nextClockAction } from '@/app/services/kiosk-state';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const clockLimiter = upstashUrl && upstashToken
  ? new Ratelimit({
      redis: new Redis({ url: upstashUrl, token: upstashToken }),
      limiter: Ratelimit.slidingWindow(8, '5 m'),
      prefix: 'rl:clock',
    })
  : null;

const memAttempts = new Map<string, { count: number; firstAttempt: number }>();
function memOk(keyId: string): boolean {
  const now = Date.now();
  const rec = memAttempts.get(keyId);
  if (!rec || now - rec.firstAttempt > 5 * 60 * 1000) {
    memAttempts.set(keyId, { count: 1, firstAttempt: now });
    return true;
  }
  rec.count++;
  return rec.count <= 8;
}

async function clockRateOk(keyId: string): Promise<boolean> {
  if (clockLimiter) return (await clockLimiter.limit(keyId)).success;
  return memOk(keyId);
}

export async function getKioskRoster() {
  if (!(await getKioskSession())) return [];
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { stylist: { select: { imageUrl: true } } },
  });
  const openByEmployee = new Set(
    (await prisma.timeEntry.findMany({ where: { clockOut: null }, select: { employeeId: true } })).map((t) => t.employeeId),
  );
  return employees.map((e) => ({
    id: e.id,
    name: e.name,
    title: e.title,
    imageUrl: e.stylist?.imageUrl ?? null,
    isClockedIn: openByEmployee.has(e.id),
  }));
}

export async function clockToggle(employeeId: string, pin: string) {
  if (!(await getKioskSession())) return { ok: false, error: 'Kiosk not enabled on this device' };

  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await clockRateOk(`${ip}:${employeeId}`))) {
    return { ok: false, error: 'Too many attempts. Please wait a few minutes.' };
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || !employee.isActive) return { ok: false, error: 'Unknown employee' };

  const valid = await verifyPin(pin, employee.pinHash);
  if (!valid) return { ok: false, error: 'Incorrect PIN' };

  const open = await prisma.timeEntry.findFirst({
    where: { employeeId, clockOut: null },
    orderBy: { clockIn: 'desc' },
    select: { id: true },
  });

  const action = nextClockAction(open);
  if (action.type === 'CLOCK_IN') {
    await prisma.timeEntry.create({ data: { employeeId, clockIn: new Date(), source: 'KIOSK', status: 'OPEN' } });
    revalidatePath('/kiosk');
    return { ok: true, status: 'IN' as const, name: employee.name };
  }
  await prisma.timeEntry.update({
    where: { id: action.entryId },
    data: { clockOut: new Date(), status: 'PENDING' },
  });
  revalidatePath('/kiosk');
  return { ok: true, status: 'OUT' as const, name: employee.name };
}

export async function enableKioskMode() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'Unauthorized' };
  await createKioskSession();
}

export async function disableKioskMode() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return;
  await deleteKioskSession();
}
