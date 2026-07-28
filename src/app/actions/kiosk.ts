'use server';

import prisma from '@/app/lib/prisma';
import { verifySession, createKioskSession, deleteKioskSession, getKioskSession } from '@/app/lib/session';
import { verifyPin } from '@/app/lib/pin';
import { nextClockAction } from '@/app/services/kiosk-state';
import { runSerializableWithRetry } from '@/app/services/booking-service';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { clockLimiter } from '@/app/lib/rate-limit';

export async function getKioskRoster() {
  if (!(await getKioskSession())) return [];
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    // Project in the query, not just in the mapping below — keep pinHash, pay
    // rates and salary out of what a kiosk device (behind only a cookie) loads.
    select: {
      id: true,
      name: true,
      title: true,
      stylist: { select: { imageUrl: true } },
    },
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
  if (!(await clockLimiter.check(`${ip}:${employeeId}`))) {
    return { ok: false, error: 'Too many attempts. Please wait a few minutes.' };
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || !employee.isActive) return { ok: false, error: 'Unknown employee' };

  const valid = await verifyPin(pin, employee.pinHash);
  if (!valid) return { ok: false, error: 'Incorrect PIN' };

  // Read the open entry and act on it inside one Serializable transaction so a
  // double-tap can't have two concurrent calls both see "no open entry" and both
  // create one (which would inflate the employee's hours in payroll).
  // runSerializableWithRetry (shared with booking-service) transparently retries
  // on P2034 serialization conflicts; if all retries are exhausted (or any other
  // error occurs), fall back to a friendly message instead of throwing to the client.
  let result;
  try {
    result = await runSerializableWithRetry(async (tx) => {
      const open = await tx.timeEntry.findFirst({
        where: { employeeId, clockOut: null },
        orderBy: { clockIn: 'desc' },
        select: { id: true },
      });

      const action = nextClockAction(open);
      if (action.type === 'CLOCK_IN') {
        await tx.timeEntry.create({ data: { employeeId, clockIn: new Date(), source: 'KIOSK', status: 'OPEN' } });
        return { status: 'IN' as const };
      }
      await tx.timeEntry.update({
        where: { id: action.entryId },
        data: { clockOut: new Date(), status: 'PENDING' },
      });
      return { status: 'OUT' as const };
    });
  } catch (error) {
    console.error('clockToggle transaction failed:', error);
    return { ok: false, error: 'Please try again' };
  }

  revalidatePath('/kiosk');
  return { ok: true, status: result.status, name: employee.name };
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
