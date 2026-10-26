import test from 'node:test';
import assert from 'node:assert/strict';
import { freshaMirrorCalendarConfig, googleCalendarConfig } from './google-calendar-config';

const KEY = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';
const VARIABLES = [
  'GOOGLE_CALENDAR_ID', 'GOOGLE_CALENDAR_SA_EMAIL',
  'GOOGLE_CALENDAR_SA_PRIVATE_KEY', 'GOOGLE_CALENDAR_WEBHOOK_SECRET',
] as const;

function environment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    GOOGLE_CALENDAR_SYNC_ENABLED: 'true',
    GOOGLE_CALENDAR_ID: 'abc123@group.calendar.google.com',
    GOOGLE_CALENDAR_SA_EMAIL: 'sync@harbour.iam.gserviceaccount.com',
    GOOGLE_CALENDAR_SA_PRIVATE_KEY: KEY,
    GOOGLE_CALENDAR_WEBHOOK_SECRET: 'webhook-secret',
    ...overrides,
  };
}

test('all five variables give a configuration', () => {
  assert.deepEqual(googleCalendarConfig(environment()), {
    calendarId: 'abc123@group.calendar.google.com',
    clientEmail: 'sync@harbour.iam.gserviceaccount.com',
    privateKey: KEY,
    webhookSecret: 'webhook-secret',
  });
});

test('values are trimmed', () => {
  const config = googleCalendarConfig(environment({ GOOGLE_CALENDAR_ID: '  cal@group.calendar.google.com \n' }));
  assert.equal(config?.calendarId, 'cal@group.calendar.google.com');
});

test('any missing or blank variable turns sync off', () => {
  for (const name of VARIABLES) {
    for (const value of [undefined, '', '   ']) {
      assert.equal(googleCalendarConfig(environment({ [name]: value })), null, `${name}=${JSON.stringify(value)}`);
    }
  }
});

test('a [SENSITIVE] placeholder counts as missing', () => {
  for (const name of VARIABLES) {
    assert.equal(googleCalendarConfig(environment({ [name]: '[SENSITIVE]' })), null, name);
  }
});

test('sync is off unless GOOGLE_CALENDAR_SYNC_ENABLED is exactly "true"', () => {
  for (const flag of [undefined, '', 'false', 'TRUE', '1', ' true ', '[SENSITIVE]']) {
    assert.equal(googleCalendarConfig(environment({ GOOGLE_CALENDAR_SYNC_ENABLED: flag })), null, String(flag));
  }
});

test('a preview deployment never syncs, whatever its variables say', () => {
  assert.equal(googleCalendarConfig(environment({ VERCEL_ENV: 'preview' })), null);
  assert.notEqual(googleCalendarConfig(environment({ VERCEL_ENV: 'production' })), null);
});

test('literal \\n sequences in the private key become newlines', () => {
  const config = googleCalendarConfig(environment({
    GOOGLE_CALENDAR_SA_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
  }));
  assert.equal(config?.privateKey, KEY);
});

test('reads process.env by default, at call time', () => {
  const saved = { ...process.env };
  try {
    for (const [name, value] of Object.entries(environment())) if (name.startsWith('GOOGLE_')) process.env[name] = value;
    delete process.env.VERCEL_ENV;
    assert.equal(googleCalendarConfig()?.calendarId, 'abc123@group.calendar.google.com');
    process.env.GOOGLE_CALENDAR_SYNC_ENABLED = 'false';
    assert.equal(googleCalendarConfig(), null);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test('the Fresha mirror writes to its own calendar with the same service account', () => {
  const config = freshaMirrorCalendarConfig(environment({ GOOGLE_FRESHA_MIRROR_CALENDAR_ID: ' fresha@group.calendar.google.com ' }));
  assert.equal(config?.calendarId, 'fresha@group.calendar.google.com');
  assert.equal(config?.clientEmail, 'sync@harbour.iam.gserviceaccount.com');
});

test('the Fresha mirror is off without its calendar, without the Google sync, or on a preview', () => {
  assert.equal(freshaMirrorCalendarConfig(environment()), null);
  for (const value of ['', '  ', '[SENSITIVE]']) {
    assert.equal(freshaMirrorCalendarConfig(environment({ GOOGLE_FRESHA_MIRROR_CALENDAR_ID: value })), null, JSON.stringify(value));
  }
  const mirror = { GOOGLE_FRESHA_MIRROR_CALENDAR_ID: 'fresha@group.calendar.google.com' };
  assert.equal(freshaMirrorCalendarConfig(environment({ ...mirror, GOOGLE_CALENDAR_SYNC_ENABLED: 'false' })), null);
  assert.equal(freshaMirrorCalendarConfig(environment({ ...mirror, GOOGLE_CALENDAR_SA_PRIVATE_KEY: undefined })), null);
  assert.equal(freshaMirrorCalendarConfig(environment({ ...mirror, VERCEL_ENV: 'preview' })), null);
});

test('the Fresha mirror refuses the salon calendar itself (its pull would send the copies back to Fresha)', () => {
  assert.equal(freshaMirrorCalendarConfig(environment({ GOOGLE_FRESHA_MIRROR_CALENDAR_ID: 'ABC123@group.calendar.google.com' })), null);
});
