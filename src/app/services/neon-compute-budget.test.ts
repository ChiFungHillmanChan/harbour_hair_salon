import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EVENTS_REVALIDATE_SECONDS, TOKEN_REVALIDATE_SECONDS } from './stylist-ical-cache';

// Neon's free plan is 100 CU-hours a month and every separate database wake
// costs at least five minutes of compute (the fixed idle-suspend tail). The
// cost driver is therefore HOW OFTEN something touches the database, so these
// tests pin the schedule-level decisions that keep the monthly total well
// under the cap. See "Neon compute budget" in CLAUDE.md before loosening any.

type Cron = { path: string; schedule: string };
async function vercelConfig(): Promise<{ crons: Cron[]; git?: { deploymentEnabled?: boolean } }> {
  return JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));
}

/** Smallest gap in minutes between runs within an hour, from the minute field. */
function minuteInterval(schedule: string): number {
  const minute = schedule.split(' ')[0];
  const step = /^\*\/(\d+)$/.exec(minute);
  if (step) return Number(step[1]);
  if (minute === '*') return 1;
  const minutes = minute.split(',').map(Number).sort((a, b) => a - b);
  if (minutes.length === 1) return 60;
  const gaps = minutes.map((m, i) => ((minutes[(i + 1) % minutes.length] - m + 60) % 60) || 60);
  return Math.min(...gaps);
}

test('no scheduled job runs more often than every 30 minutes', async () => {
  for (const cron of (await vercelConfig()).crons) {
    assert.ok(minuteInterval(cron.schedule) >= 30, `${cron.path} runs every ${minuteInterval(cron.schedule)} minutes.`);
  }
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

test('the public iCal feed cache does not expire on a short timer', () => {
  // Marketplaces poll the feed every 5-15 minutes around the clock; every
  // expiry turns the next poll into a database wake. Appointment mutations
  // invalidate the entry immediately, so the timer is only a safety net.
  assert.ok(EVENTS_REVALIDATE_SECONDS >= 12 * 60 * 60, `events cache expires every ${EVENTS_REVALIDATE_SECONDS}s`);
  assert.equal(TOKEN_REVALIDATE_SECONDS, false);
});

test('production deploys come only from GitHub Actions, never from Vercel\'s own git builds', async () => {
  // The CI job runs the full test and PostgreSQL gate BEFORE `vercel deploy
  // --prod`. Vercel's git integration would deploy the same push immediately,
  // untested, ahead of it.
  assert.equal((await vercelConfig()).git?.deploymentEnabled, false);
});
