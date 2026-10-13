import { NextRequest, NextResponse } from 'next/server';
import { safeCompare } from './reminder-window';
import { runNotificationCron } from '@/app/services/notification-cron-service';
import { describeFault } from '@/app/lib/fault';

export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  if (!safeCompare(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.NOTIFICATIONS_ENABLED !== 'true') return NextResponse.json({ enabled: false });
  let result: Awaited<ReturnType<typeof runNotificationCron>> | null = null;
  try {
    result = await runNotificationCron('reminders');
  } catch {
    // Fall through: a failing worker is exactly what the ops alert is for.
  }
  const opsAlert = await runOpsAlert();
  if (!result) return NextResponse.json({ error: 'Notification worker failed', opsAlert }, { status: 503 });
  return NextResponse.json({ ...result, opsAlert }, { status: result.failed > 0 ? 503 : 200 });
}

/** The once-a-day "needs attention" mail to the salon, on this cron's existing wake. Never fails the cron. */
async function runOpsAlert(): Promise<{ sent: boolean; findings: number } | { error: true }> {
  try {
    const [{ sendDailyOpsAlert }, { sendSalonNotice }, { default: prisma }] = await Promise.all([
      import('@/app/services/ops-alert-service'),
      import('@/app/services/email-service'),
      import('@/app/lib/prisma'),
    ]);
    return await sendDailyOpsAlert({
      db: prisma,
      now: new Date(),
      calendarSyncEnabled: process.env.CALENDAR_SYNC_ENABLED === 'true',
      housekeepingEnabled: process.env.HOUSEKEEPING_ENABLED === 'true',
      send: sendSalonNotice,
    });
  } catch (error) {
    console.error('Daily ops alert failed', describeFault(error));
    return { error: true };
  }
}
