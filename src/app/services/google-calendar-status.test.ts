import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { OPERATIONS_MESSAGES } from './operations-messages';

// Admin → Integrations → Google Calendar (task G9, spec §7–§8): what the
// status panel shows. With the sync off it answers before the database is
// touched; with it on, the calendar id is masked and nothing secret is read.

const ENV = {
  GOOGLE_CALENDAR_SYNC_ENABLED: 'true',
  GOOGLE_CALENDAR_ID: 'abcdef1234567890@group.calendar.google.com',
  GOOGLE_CALENDAR_SA_EMAIL: 'sa@harbour.iam.gserviceaccount.com',
  GOOGLE_CALENDAR_SA_PRIVATE_KEY: 'key',
  GOOGLE_CALENDAR_WEBHOOK_SECRET: 'secret',
} as unknown as NodeJS.ProcessEnv;

type State = { channelExpiresAt: Date | null; lastPullAt: Date | null; lastPullSuccessAt: Date | null; lastPullError: string | null } | null;

function load(state: State, failed = 0) {
  const calls: string[] = [];
  const selects: unknown[] = [];
  const db = {
    googleCalendarSyncState: { findUnique: async (args: { select: unknown }) => { calls.push('state'); selects.push(args.select); return state; } },
    googleCalendarEvent: { count: async (args: { where: unknown }) => { calls.push('count'); selects.push(args.where); return failed; } },
  };
  const loaded = loadServerModule<typeof import('./google-calendar-status')>('src/app/services/google-calendar-status.ts', {
    'server-only': {},
  });
  return { loaded, db, calls, selects };
}

test('with the sync off the status is "off" and the database is never touched', async () => {
  const f = load(null);
  assert.deepEqual(await f.loaded.getGoogleCalendarStatus({ db: f.db as never, env: {} as NodeJS.ProcessEnv }), { enabled: false });
  assert.deepEqual(await f.loaded.getGoogleCalendarStatus({ db: f.db as never, env: { ...ENV, VERCEL_ENV: 'preview' } }), { enabled: false });
  assert.deepEqual(f.calls, []);
});

test('with the sync on: masked calendar id, channel, last pull and failed bookings', async () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 16, hour));
  const f = load({ channelExpiresAt: at(20), lastPullAt: at(12), lastPullSuccessAt: at(11), lastPullError: OPERATIONS_MESSAGES.GOOGLE_PULL_FAILED }, 3);
  const status = await f.loaded.getGoogleCalendarStatus({ db: f.db as never, env: ENV });
  assert.deepEqual(status, {
    enabled: true,
    calendarId: 'abcdef…',
    channelExpiresAt: at(20),
    lastPullAt: at(12),
    lastPullSuccessAt: at(11),
    lastPullError: OPERATIONS_MESSAGES.GOOGLE_PULL_FAILED,
    failedEvents: 3,
  });
  // Only the columns shown are read; the channel id and busy hash stay in the database.
  assert.deepEqual(f.selects[0], { channelExpiresAt: true, lastPullAt: true, lastPullSuccessAt: true, lastPullError: true });
  assert.deepEqual(f.selects[1], { lastError: { not: null } });
});

test('a sync that has never pulled has an empty status, not an error', async () => {
  const f = load(null, 0);
  assert.deepEqual(await f.loaded.getGoogleCalendarStatus({ db: f.db as never, env: ENV }), {
    enabled: true, calendarId: 'abcdef…', channelExpiresAt: null, lastPullAt: null, lastPullSuccessAt: null, lastPullError: null, failedEvents: 0,
  });
});

test('a short calendar id is never shown in full', async () => {
  const f = load(null);
  const status = await f.loaded.getGoogleCalendarStatus({ db: f.db as never, env: { ...ENV, GOOGLE_CALENDAR_ID: 'primary' } });
  assert.equal(status.enabled && status.calendarId, 'primar…');
});
