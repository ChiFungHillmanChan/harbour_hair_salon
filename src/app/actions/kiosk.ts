'use server';

import prisma from '@/app/lib/prisma';
import { revalidateAllLocales } from '@/i18n/revalidate';
import { verifySession, requireAdmin, createKioskSession, deleteKioskSession, getKioskSession, deleteSession } from '@/app/lib/session';
import { verifyPin } from '@/app/lib/pin';
import { nextClockAction } from '@/app/services/kiosk-state';
import { runSerializableWithRetry } from '@/app/services/booking-service';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { clockLimiter } from '@/app/lib/rate-limit';
import { z } from 'zod';
import { appendAuditEvent } from '@/app/lib/audit';
import { getActionT, localizedPath } from '@/i18n/request';

/**
 * Why a clock-in/out was refused. The kiosk shows the code in the device's
 * current language; `error` is the same text in the language of the request.
 */
export type ClockErrorCode = 'NOT_ENABLED' | 'RATE_LIMITED' | 'UNKNOWN_EMPLOYEE' | 'WRONG_PIN' | 'RETRY';

async function clockError(code: ClockErrorCode) {
  const t = await getActionT('kiosk');
  return { ok: false as const, code, error: t(`errors.${code}`) };
}

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
  if (!(await getKioskSession())) return clockError('NOT_ENABLED');

  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await clockLimiter.check(`${ip}:${employeeId}`))) {
    return clockError('RATE_LIMITED');
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || !employee.isActive) return clockError('UNKNOWN_EMPLOYEE');

  const valid = await verifyPin(pin, employee.pinHash);
  if (!valid) return clockError('WRONG_PIN');

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
    return clockError('RETRY');
  }

  revalidateAllLocales(revalidatePath, '/kiosk');
  return { ok: true as const, status: result.status, name: employee.name };
}

export async function enableKioskMode(deviceName = 'Salon kiosk') {
  const session = await verifySession();
  const t = await getActionT('adminStaff');
  if (session.role !== 'ADMIN') return { error: t('kioskDevices.errors.UNAUTHORIZED') };
  const name = z.string().trim().min(1).max(80).safeParse(deviceName);
  if (!name.success) return { error: t('kioskDevices.errors.DEVICE_NAME') };
  await createKioskSession(session.userId, name.data);
  // The shared staff device must keep only its kiosk access after the handoff.
  await deleteSession();
  // The kiosk opens in the language the admin was using; its own switcher
  // then changes it for the device only.
  redirect(await localizedPath('/kiosk'));
}

export async function disableKioskMode() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return;
  await deleteKioskSession(session.userId);
  revalidateAllLocales(revalidatePath, '/admin/employees');
}

export async function listKioskSessions() {
  await requireAdmin();
  return prisma.kioskSession.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, deviceName: true, createdAt: true, expiresAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 100,
  });
}

export async function revokeKioskSession(id: string) {
  const session = await requireAdmin();
  const parsed = z.string().min(1).max(128).safeParse(id);
  if (!parsed.success) return { error: (await getActionT('adminStaff'))('kioskDevices.errors.INVALID_DEVICE') };
  await prisma.$transaction(async (tx) => {
    const changed = await tx.kioskSession.updateMany({
      where: { id: parsed.data, revokedAt: null }, data: { revokedAt: new Date() },
    });
    if (changed.count > 0) await appendAuditEvent({ actorUserId: session.userId, action: 'KIOSK.REVOKED', targetType: 'KioskSession', targetId: parsed.data }, tx);
  });
  revalidateAllLocales(revalidatePath, '/admin/employees');
  return { success: true };
}

export async function revokeAllKioskSessions() {
  const session = await requireAdmin();
  await prisma.$transaction(async (tx) => {
    const changed = await tx.kioskSession.updateMany({
      where: { revokedAt: null }, data: { revokedAt: new Date() },
    });
    await appendAuditEvent({ actorUserId: session.userId, action: 'KIOSK.REVOKED_ALL', targetType: 'KioskSession', metadata: { count: changed.count } }, tx);
  });
  revalidateAllLocales(revalidatePath, '/admin/employees');
  return { success: true };
}
