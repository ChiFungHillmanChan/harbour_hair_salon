import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadServerModule } from '../../test/load-server-module';

// Neon's free plan is 100 CU-hours a month and every separate database wake
// costs at least five minutes of compute (the fixed idle-suspend tail). The
// cost driver is therefore HOW OFTEN something touches the database, so these
// tests pin the schedule-level decisions that keep the monthly total well
// under the cap. See "Neon compute budget" in CLAUDE.md before loosening any.

type Cron = { path: string; schedule: string };
async function vercelConfig(): Promise<{ crons: Cron[]; git?: { deploymentEnabled?: boolean } }> {
  return JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));
}

/** Expand one cron field ("*", "5", "0-29", "*\/30", "0-59/5", "10/15", lists). */
function expand(field: string, min: number, max: number): number[] {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    const [lo, hi] = range === '*' ? [min, max]
      : range.includes('-') ? range.split('-').map(Number)
      : [Number(range), stepText ? max : Number(range)];
    for (let value = lo; value <= hi; value += step) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

/** Minutes-of-day a schedule fires at (day-of-month/month/weekday ignored). */
function fireTimes(schedule: string): number[] {
  const [minute, hour] = schedule.split(' ');
  return expand(hour, 0, 23).flatMap((h) => expand(minute, 0, 59).map((m) => h * 60 + m));
}

/** Smallest gap between runs, including the wrap into the next day. Same-minute runs share one wake. */
function smallestGap(times: number[]): number {
  const sorted = [...new Set(times)].sort((a, b) => a - b);
  if (sorted.length < 2) return 24 * 60;
  return Math.min(...sorted.map((t, i) => (i + 1 < sorted.length ? sorted[i + 1] - t : sorted[0] + 24 * 60 - t)));
}

test('the cron interval helper reads ranges, steps and lists correctly', () => {
  for (const [schedule, gap] of [
    ['0 8 * * *', 1440], ['15 3 * * *', 1440], ['*/30 8-19 * * *', 30], ['0,30 * * * *', 30],
    ['*/10 * * * *', 10], ['0-59/5 8-19 * * *', 5], ['*/45 * * * *', 15], ['0-29 * * * *', 1], ['10/15 * * * *', 15],
  ] as const) assert.equal(smallestGap(fireTimes(schedule)), gap, schedule);
});

test('no scheduled job runs more often than every 30 minutes', async () => {
  for (const cron of (await vercelConfig()).crons) {
    const gap = smallestGap(fireTimes(cron.schedule));
    assert.ok(gap >= 30, `${cron.path} runs every ${gap} minutes.`);
  }
});

test('the repeating jobs share their wakes instead of interleaving', async () => {
  // calendar-sync and notifications must land in the SAME minutes (:00/:30):
  // staggered at :15/:45 each would still pass the per-job rule above while
  // waking the database every 15 minutes. Once-a-day jobs are left out.
  const repeating = (await vercelConfig()).crons.filter((cron) => fireTimes(cron.schedule).length > 1);
  const gap = smallestGap(repeating.flatMap((cron) => fireTimes(cron.schedule)));
  assert.ok(gap >= 30, `together the repeating jobs wake the database every ${gap} minutes`);
});

test('the notifications job does not run overnight', async () => {
  // Reminders look 36 hours ahead and confirmations are sent inline, so the
  // retry/reminder worker gains nothing from night runs — each would be its
  // own Neon wake once NOTIFICATIONS_ENABLED is on.
  const job = (await vercelConfig()).crons.find((cron) => cron.path === '/api/cron/notifications');
  assert.ok(job, 'notifications must stay scheduled');
  const hours = job.schedule.split(' ')[1];
  assert.notEqual(hours, '*', 'notifications must be limited to daytime UTC hours');
  const range = /^(\d+)-(\d+)$/.exec(hours);
  assert.ok(range, `Expected an hour range, got "${hours}"`);
  assert.ok(Number(range[2]) - Number(range[1]) + 1 <= 12, 'notifications should run at most 12 hours a day');
});

test('the public iCal feed caches do not expire on a short timer', () => {
  // Marketplaces poll the feed every 5-15 minutes around the clock; every
  // expiry turns the next poll into a database wake. Appointment mutations
  // invalidate the entry immediately, so the timer is only a safety net.
  // Records what is ACTUALLY passed to unstable_cache, not an exported constant.
  const options = new Map<string, { revalidate?: number | false }>();
  loadServerModule('src/app/services/stylist-ical-cache.ts', {
    'next/cache': {
      unstable_cache: (callback: unknown, keyParts: string[], cacheOptions: { revalidate?: number | false }) => {
        options.set(keyParts.join('/'), cacheOptions);
        return callback;
      },
      updateTag: () => undefined,
    },
    './stylist-ical-feed': {},
  });
  const events = options.get('stylist-ical-events')?.revalidate;
  const token = options.get('stylist-ical-token')?.revalidate;
  assert.ok(events === false || (typeof events === 'number' && events >= 12 * 60 * 60), `events cache expires every ${events}s`);
  assert.ok(token === false || (typeof token === 'number' && token >= 24 * 60 * 60), `token cache expires every ${token}s`);
});

test('production deploys come only from GitHub Actions, never from Vercel\'s own git builds', async () => {
  // The CI job runs the full test and PostgreSQL gate BEFORE `vercel deploy
  // --prod`. Vercel's git integration would deploy the same push immediately,
  // untested, ahead of it.
  assert.equal((await vercelConfig()).git?.deploymentEnabled, false);
});
