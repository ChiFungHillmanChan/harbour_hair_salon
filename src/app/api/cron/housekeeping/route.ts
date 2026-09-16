import { NextRequest, NextResponse } from 'next/server';
import { safeCompare } from '../reminders/reminder-window';
import { runHousekeeping } from '@/app/services/housekeeping-service';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  if (!safeCompare(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Retention can run while sending is disabled; this separate rollout flag
  // keeps prelaunch environments from opening database connections by default.
  if (process.env.HOUSEKEEPING_ENABLED !== 'true') return NextResponse.json({ enabled: false });
  try { return NextResponse.json(await runHousekeeping()); }
  catch { return NextResponse.json({ error: 'Housekeeping failed' }, { status: 503 }); }
}
