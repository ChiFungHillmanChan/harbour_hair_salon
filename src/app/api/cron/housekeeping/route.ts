import { NextRequest, NextResponse } from 'next/server';
import { safeCompare } from '../reminders/reminder-window';
import { runHousekeeping } from '@/app/services/housekeeping-service';
import { lapseStartedPendingRequests } from '@/app/services/pending-request-lapse';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  if (!safeCompare(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // ON unless explicitly switched off: the privacy notice's retention periods
  // (queued email copies cleared after 30 days, delivery records deleted after
  // 12 months), crashed-delivery recovery and request lapsing all depend on it.
  // One daily wake (~2.5 CU-hours a month). Set HOUSEKEEPING_ENABLED=false only
  // for an environment that must not touch its database (e.g. CI).
  if (process.env.HOUSEKEEPING_ENABLED === 'false') return NextResponse.json({ enabled: false });
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
