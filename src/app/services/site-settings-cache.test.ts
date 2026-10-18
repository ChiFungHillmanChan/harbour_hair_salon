import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

/**
 * A stand-in for Next's Data Cache with the property that matters here: only a
 * callback that RETURNS is stored; one that throws stores nothing.
 */
function settingsFixture() {
  let reachable = false;
  const store = new Map<string, unknown>();
  const settingsRow = {
    id: 'singleton', phone: '0113 000 0000', twitterHandle: '', gscVerification: '', googleBusinessUrl: '', facebookUrl: '',
    instagramUrl: '', treatwellUrl: '', freshaUrl: 'https://www.fresha.com/harbour', booksyUrl: '',
    heroEyebrow: 'Owner eyebrow', heroTitleLine1: 'Owner title', heroTitleLine2: 'line two', heroSubtitle: 'Owner subtitle',
    bookingEnabled: false, salonNotificationLocale: 'en-GB', bookingBetaEmails: 'tester@example.com',
  };
  const service = loadServerModule<typeof import('./site-settings-service')>('src/app/services/site-settings-service.ts', {
    '@/app/lib/prisma': { siteSettings: {
      findUnique: async () => { if (!reachable) throw new Error("Can't reach database server"); return settingsRow; },
      create: async () => { throw new Error('unexpected create'); },
    } },
    'next/cache': {
      unstable_cache: (read: () => Promise<unknown>, keyParts: string[]) => async () => {
        const key = keyParts.join('/');
        if (!store.has(key)) store.set(key, await read());
        return store.get(key);
      },
    },
    // React's per-render cache is irrelevant across these calls.
    react: { cache: <T>(fn: T) => fn },
  });
  return { service, store, row: settingsRow, reach: () => { reachable = true; } };
}

test('a cold or unreachable database is never cached as the site\'s settings', async () => {
  const f = settingsFixture();
  const errors = console.error;
  console.error = () => {};
  try {
    const fallback = await f.service.getSiteSettings();
    assert.equal(fallback.phone, '07831 830898', 'this request falls back to the defaults…');
    assert.equal(f.store.size, 0, '…but nothing is stored');
  } finally {
    console.error = errors;
  }
  f.reach();
  const settings = await f.service.getSiteSettings();
  assert.equal(settings.phone, '0113 000 0000', 'the very next request reads the salon\'s real settings');
  assert.equal(settings.freshaUrl, 'https://www.fresha.com/harbour');
  assert.equal(f.store.size, 1);
});

test('Admin → Settings reads the live row, so a stale cache can never be saved back over newer values', async () => {
  const f = settingsFixture();
  f.reach();
  await f.service.getSiteSettings(); // the public cache now holds bookingEnabled: false
  f.row.bookingEnabled = true; // e.g. a direct database write the cache has not seen
  assert.equal((await f.service.getSiteSettings()).bookingEnabled, false, 'public pages still serve the cached copy');
  assert.equal((await f.service.getSiteSettingsForEditing()).bookingEnabled, true, 'the settings form shows the live value');
  assert.equal(f.store.size, 1, 'the editing read neither uses nor fills the cache');
});

test('the editing read never falls back to defaults when the database is unreachable', async () => {
  const f = settingsFixture();
  await assert.rejects(() => f.service.getSiteSettingsForEditing(), /reach database/);
});

test('beta testers\' emails stay out of the public cached settings; only the editing read carries them', async () => {
  const f = settingsFixture();
  f.reach();
  const cached = await f.service.getSiteSettings();
  assert.equal('bookingBetaEmails' in cached, false, 'personal data never enters the copy every public page reads');
  assert.equal(JSON.stringify([...f.store.values()]).includes('tester@example.com'), false);
  assert.equal((await f.service.getSiteSettingsForEditing()).bookingBetaEmails, 'tester@example.com');
});
