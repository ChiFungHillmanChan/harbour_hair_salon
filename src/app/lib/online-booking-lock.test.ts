import test from 'node:test';
import assert from 'node:assert/strict';
import { isOnlineBookingLockedForPayments, publicSquareConfig, SQUARE_DEPOSITS_WIRED, usableSquareConfig } from './online-booking-lock';
import { loadServerModule } from '../../test/load-server-module';

const PRODUCTION_BUILD = { NODE_ENV: 'production', VERCEL_ENV: 'production' };

const SQUARE_PRODUCTION = {
  SQUARE_PAYMENTS_ENABLED: 'true',
  SQUARE_ENVIRONMENT: 'production',
  SQUARE_ACCESS_TOKEN: 'production-access-token',
  SQUARE_APPLICATION_ID: 'sq0idp-production-application',
  SQUARE_LOCATION_ID: 'production-location',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'production-signature-key',
  SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://www.harbourhair.co.uk/api/webhooks/square',
};

const SQUARE_SANDBOX = { ...SQUARE_PRODUCTION, SQUARE_ENVIRONMENT: 'sandbox', SQUARE_APPLICATION_ID: 'sandbox-sq0idb-test-application' };

/** Invalid configurations are reported once per instance; keep the test output clean. */
function quietly<T>(run: () => T): T {
  const errors = console.error;
  console.error = () => {};
  try {
    return run();
  } finally {
    console.error = errors;
  }
}

test('the deposit code path exists, so the production lock follows the Square configuration', () => {
  assert.equal(SQUARE_DEPOSITS_WIRED, true);
});

test('a production build without Square configured stays locked', () => {
  assert.equal(isOnlineBookingLockedForPayments(PRODUCTION_BUILD), true);
  // Fails closed if Vercel ever stops exposing VERCEL_ENV at runtime.
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'production' }), true);
  // Production credentials present but the Square kill switch is off: still locked.
  for (const flag of [undefined, 'false', 'TRUE']) {
    assert.equal(isOnlineBookingLockedForPayments({ ...PRODUCTION_BUILD, ...SQUARE_PRODUCTION, SQUARE_PAYMENTS_ENABLED: flag }), true, String(flag));
  }
});

test('sandbox credentials can never open production', () => {
  assert.equal(isOnlineBookingLockedForPayments({ ...PRODUCTION_BUILD, ...SQUARE_SANDBOX }), true);
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'production', ...SQUARE_SANDBOX }), true);
  // An unset SQUARE_ENVIRONMENT means sandbox.
  assert.equal(isOnlineBookingLockedForPayments({ ...PRODUCTION_BUILD, ...SQUARE_SANDBOX, SQUARE_ENVIRONMENT: undefined }), true);
});

test('a valid production Square configuration unlocks a production build', () => {
  assert.equal(isOnlineBookingLockedForPayments({ ...PRODUCTION_BUILD, ...SQUARE_PRODUCTION }), false);
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'production', ...SQUARE_PRODUCTION }), false);
});

test('a configuration that does not parse keeps production locked instead of throwing', () => {
  quietly(() => {
    for (const broken of [
      { SQUARE_ACCESS_TOKEN: undefined },
      { SQUARE_ACCESS_TOKEN: '[SENSITIVE]' },
      { SQUARE_LOCATION_ID: '   ' },
      // A sandbox application id cannot pass as production.
      { SQUARE_APPLICATION_ID: 'sandbox-sq0idb-test-application' },
      { SQUARE_ENVIRONMENT: 'live' },
      { SQUARE_WEBHOOK_NOTIFICATION_URL: 'http://www.harbourhair.co.uk/api/webhooks/square' },
    ]) {
      assert.equal(isOnlineBookingLockedForPayments({ ...PRODUCTION_BUILD, ...SQUARE_PRODUCTION, ...broken }), true, JSON.stringify(broken));
    }
  });
});

test('an invalid configuration is logged by field name only, once per instance', () => {
  // A fresh copy of the module, so the once-per-instance report is unused.
  const lock = loadServerModule<typeof import('./online-booking-lock')>('src/app/lib/online-booking-lock.ts', {});
  const lines: unknown[][] = [];
  const errors = console.error;
  console.error = (...args: unknown[]) => { lines.push(args); };
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal(lock.isOnlineBookingLockedForPayments({ ...PRODUCTION_BUILD, ...SQUARE_PRODUCTION, SQUARE_ACCESS_TOKEN: 'has a space' }), true);
    }
  } finally {
    console.error = errors;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0].join(' '), /SQUARE_ACCESS_TOKEN/);
  assert.doesNotMatch(lines[0].join(' '), /has a space|production-signature-key/);
});

test('previews, development, unit tests and CI scripts are never locked, whatever Square says', () => {
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }), false);
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'production', VERCEL_ENV: 'preview', ...SQUARE_SANDBOX }), false);
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'development' }), false);
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'development', ...SQUARE_SANDBOX, SQUARE_ACCESS_TOKEN: '' }), false);
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'test' }), false);
  assert.equal(isOnlineBookingLockedForPayments({}), false);
});

// A deposit is taken with the configuration the lock would open for, or not
// at all: submitBooking refuses PAYMENT_UNAVAILABLE when this is null.
test('in a production build only production credentials can take a deposit', () => {
  assert.equal(usableSquareConfig({ ...PRODUCTION_BUILD, ...SQUARE_PRODUCTION })?.environment, 'production');
  assert.equal(usableSquareConfig({ NODE_ENV: 'production', ...SQUARE_PRODUCTION })?.locationId, 'production-location');
  quietly(() => {
    assert.equal(usableSquareConfig({ ...PRODUCTION_BUILD, ...SQUARE_SANDBOX }), null, 'sandbox cards never take a live deposit');
    assert.equal(usableSquareConfig({ NODE_ENV: 'production', ...SQUARE_SANDBOX }), null, 'a missing VERCEL_ENV still counts as production');
  });
});

test('the browser gets the public part of a usable configuration only', () => {
  assert.deepEqual(publicSquareConfig({ ...PRODUCTION_BUILD, ...SQUARE_PRODUCTION }), {
    applicationId: 'sq0idp-production-application', locationId: 'production-location', environment: 'production',
  });
  quietly(() => assert.equal(publicSquareConfig({ ...PRODUCTION_BUILD, ...SQUARE_SANDBOX }), null));
  assert.equal(publicSquareConfig({}), null);
});

test('development, tests and previews may use the sandbox', () => {
  for (const runtime of [{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, {}, { NODE_ENV: 'production', VERCEL_ENV: 'preview' }]) {
    assert.equal(usableSquareConfig({ ...runtime, ...SQUARE_SANDBOX })?.environment, 'sandbox', JSON.stringify(runtime));
  }
});

// Previews run on a copy of the production database and are deployed from any
// branch: real cards and real money only ever move from a production build.
test('production credentials work only in a production build: previews, development and tests get none', () => {
  quietly(() => {
    for (const runtime of [{ NODE_ENV: 'production', VERCEL_ENV: 'preview' }, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }, {}]) {
      assert.equal(usableSquareConfig({ ...runtime, ...SQUARE_PRODUCTION }), null, JSON.stringify(runtime));
      assert.equal(publicSquareConfig({ ...runtime, ...SQUARE_PRODUCTION }), null, `${JSON.stringify(runtime)}: no card form either`);
    }
  });
  // The matrix: each environment's own credentials only.
  assert.equal(usableSquareConfig({ NODE_ENV: 'production', VERCEL_ENV: 'preview', ...SQUARE_SANDBOX })?.environment, 'sandbox');
  assert.equal(usableSquareConfig({ ...PRODUCTION_BUILD, ...SQUARE_PRODUCTION })?.environment, 'production');
  assert.equal(usableSquareConfig({ ...PRODUCTION_BUILD, ...SQUARE_SANDBOX }), null);
});

test('credentials refused for this kind of deployment are reported once, by rule, never by value', () => {
  const lock = loadServerModule<typeof import('./online-booking-lock')>('src/app/lib/online-booking-lock.ts', {});
  const lines: unknown[][] = [];
  const errors = console.error;
  console.error = (...args: unknown[]) => { lines.push(args); };
  try {
    for (let i = 0; i < 3; i++) assert.equal(lock.usableSquareConfig({ NODE_ENV: 'production', VERCEL_ENV: 'preview', ...SQUARE_PRODUCTION }), null);
  } finally {
    console.error = errors;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0].join(' '), /production/i);
  assert.doesNotMatch(lines[0].join(' '), /production-access-token|production-signature-key|production-location/);
});

test('switched off, incomplete or malformed configuration is no configuration, never an exception', () => {
  quietly(() => {
    for (const env of [
      {},
      { ...SQUARE_SANDBOX, SQUARE_PAYMENTS_ENABLED: 'false' },
      { ...SQUARE_SANDBOX, SQUARE_ACCESS_TOKEN: '[SENSITIVE]' },
      { ...SQUARE_SANDBOX, SQUARE_LOCATION_ID: undefined },
      { ...PRODUCTION_BUILD, ...SQUARE_PRODUCTION, SQUARE_APPLICATION_ID: 'sandbox-sq0idb-test-application' },
    ]) {
      assert.equal(usableSquareConfig(env), null, JSON.stringify(env));
    }
  });
});
