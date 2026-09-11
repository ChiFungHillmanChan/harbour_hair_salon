import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { syncTreatwellFeeds } from '@/app/services/treatwell-sync-service';

// Fetches + parses one external feed per stylist; keep it off the default limit.
export const maxDuration = 90;

function safeCompare(a: string, b: string): boolean {
  // Compare BYTE lengths, not `String.length` (UTF-16 code units): a multibyte
  // char (e.g. a raw 0xE9 latin-1 header byte) can share code-unit length while
  // differing in UTF-8 byte length, which makes timingSafeEqual throw (→ a 500
  // instead of a clean 401). Compute the buffers once and length-check them.
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET is not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Cost kill-switch, and it MUST stay above `syncTreatwellFeeds()`.
  //
  // Neon bills compute time, and its free tier suspends the endpoint after 5
  // minutes idle. `syncTreatwellFeeds()` opens with a `stylist.findMany` — so
  // merely *entering* it wakes the database, even when no stylist has a feed
  // URL and the run is a guaranteed no-op. On a 5-minute cron that single query
  // pinned the compute awake 24/7 and burned the whole monthly CU-hour
  // allowance for zero work. Returning here keeps the request DB-free.
  //
  // Off unless explicitly enabled: re-enabling costs money, so it has to be a
  // deliberate act. Admin → Integrations → "Run iCal sync now" is unaffected
  // (it calls the service directly) and stays available for one-off runs.
  if (process.env.TREATWELL_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'disabled', results: [] });
  }

  const results = await syncTreatwellFeeds();
  const ok = results.every((r) => r.ok);
  if (!ok) console.error('Treatwell sync had failures', results.filter((r) => !r.ok));
  // Non-2xx on any failure so Vercel/EventBridge surfaces the failed run.
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 502 });
}
