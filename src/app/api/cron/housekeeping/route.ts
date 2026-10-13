import { NextRequest, NextResponse } from 'next/server';
import { safeCompare } from '../reminders/reminder-window';
import { runHousekeeping } from '@/app/services/housekeeping-service';
import { lapseStartedPendingRequests } from '@/app/services/pending-request-lapse';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  if (!safeCompare(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Retention can run while sending is disabled; this separate rollout flag
  // keeps prelaunch environments from opening database connections by default.
  if (process.env.HOUSEKEEPING_ENABLED !== 'true') return NextResponse.json({ enabled: false });
  try {
    const result = await runHousekeeping();
    // Booking requests whose time passed unanswered also close here (same
    // daily wake), so they lapse even while email sending — and with it the
    // notifications cron — is switched off. Never fails the retention run.
    let requests = { lapsed: 0, failed: 0 };
    try {
      requests = await lapseStartedPendingRequests(new Date());
    } catch (error) {
      console.error('Booking-request lapse in housekeeping failed:', error instanceof Error ? error.name : 'unknown');
      requests = { lapsed: 0, failed: 1 };
    }
    return NextResponse.json({ ...result, requestsLapsed: requests.lapsed, requestLapseFailed: requests.failed });
  }
  catch { return NextResponse.json({ error: 'Housekeeping failed' }, { status: 503 }); }
}
