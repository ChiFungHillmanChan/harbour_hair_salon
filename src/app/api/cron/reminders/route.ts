import { NextRequest, NextResponse } from 'next/server';
import { safeCompare } from './reminder-window';
import { runNotificationCron } from '@/app/services/notification-cron-service';

export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  if (!safeCompare(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.NOTIFICATIONS_ENABLED !== 'true') return NextResponse.json({ enabled: false });
  try {
    const result = await runNotificationCron('reminders');
    return NextResponse.json(result, { status: result.failed > 0 ? 503 : 200 });
  } catch {
    return NextResponse.json({ error: 'Notification worker failed' }, { status: 503 });
  }
}
