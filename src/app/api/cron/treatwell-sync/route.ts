import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { syncTreatwellFeeds } from '@/app/services/treatwell-sync-service';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
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

  const results = await syncTreatwellFeeds();
  const ok = results.every((r) => r.ok);
  if (!ok) console.error('Treatwell sync had failures', results.filter((r) => !r.ok));
  return NextResponse.json({ ok, results });
}
