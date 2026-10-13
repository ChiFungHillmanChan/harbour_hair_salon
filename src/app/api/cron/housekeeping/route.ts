import { NextRequest, NextResponse } from 'next/server';
import { safeCompare } from '../reminders/reminder-window';
import { runHousekeeping } from '@/app/services/housekeeping-service';
import { lapseStartedPendingRequests } from '@/app/services/pending-request-lapse';
import { reconcilePayments } from '@/app/services/payment-reconciliation';
import { describeFault } from '@/app/lib/fault';

// Retention, request lapses and card-deposit reconciliation share this one
// daily wake; each Square call can take 10 seconds, so the deposit checks keep
// to their own time budget (payment-reconciliation.ts) inside this limit.
export const maxDuration = 120;

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
    // notifications cron — is switched off. Only this daily run closes a
    // request whose deposit was taken, and only 12 hours after its
    // appointment ended (staff may mark it completed first: the deposit is
    // then kept). Never fails the retention run.
    let requests = { lapsed: 0, failed: 0 };
    try {
      requests = await lapseStartedPendingRequests(new Date(), { takenDeposits: true });
    } catch (error) {
      console.error('Booking-request lapse in housekeeping failed:', error instanceof Error ? error.name : 'unknown');
      requests = { lapsed: 0, failed: 1 };
    }
    // Card deposits and refunds the booking actions and the Square webhook
    // could not settle by themselves are asked about here — after the lapses,
    // which release their own requests' holds first. Without a usable Square
    // configuration nothing is read. Never fails the retention run.
    let payments: Awaited<ReturnType<typeof reconcilePayments>> | { failed: 1 };
    try {
      payments = await reconcilePayments();
    } catch (error) {
      console.error('Payment reconciliation in housekeeping failed', describeFault(error));
      payments = { failed: 1 };
    }
    return NextResponse.json({ ...result, requestsLapsed: requests.lapsed, requestLapseFailed: requests.failed, payments });
  }
  catch { return NextResponse.json({ error: 'Housekeeping failed' }, { status: 503 }); }
}
