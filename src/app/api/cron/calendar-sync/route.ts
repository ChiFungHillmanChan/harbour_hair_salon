import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { syncCalendarFeeds } from '@/app/services/calendar-sync-service';

export const maxDuration = 90;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Above the lazy service's very first DB call: a disabled cron cannot wake Neon.
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'disabled', results: [] });
  }
  const db = (await import('@/app/lib/prisma')).default;
  const name = 'calendar-sync';
  try {
    await db.backgroundJobState.upsert({ where: { name }, create: { name, lastStartedAt: new Date() }, update: { lastStartedAt: new Date() } });
    const results = await syncCalendarFeeds();
    const ok = results.every((entry) => entry.ok);
    await db.backgroundJobState.update({ where: { name }, data: {
      ...(ok ? { lastSucceededAt: new Date(), lastError: null } : { lastFailedAt: new Date(), lastError: 'Some calendar connections failed. Check Integrations; previous busy periods were retained.' }),
      lastResultJson: JSON.stringify({ connections: results.length, succeeded: results.filter((entry) => entry.ok && !entry.skipped).length, failed: results.filter((entry) => !entry.ok).length }),
    } });
    return NextResponse.json({ ok, results }, { status: ok ? 200 : 502 });
  } catch {
    try {
      await db.backgroundJobState.update({ where: { name }, data: { lastFailedAt: new Date(), lastError: 'Calendar worker could not complete. Check database and connection configuration.' } });
    } catch { /* A database outage may also prevent saving its own diagnostic. */ }
    return NextResponse.json({ ok: false, error: 'Calendar sync could not complete.' }, { status: 503 });
  }
}
