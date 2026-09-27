import test from 'node:test';
import assert from 'node:assert/strict';
import { getSquareConfig, parseSquareConfig } from './square-config';

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    SQUARE_PAYMENTS_ENABLED: 'true',
    SQUARE_ENVIRONMENT: 'sandbox',
    SQUARE_ACCESS_TOKEN: 'test-access-token',
    SQUARE_APPLICATION_ID: 'sandbox-sq0idb-test-application',
    SQUARE_LOCATION_ID: 'test-location',
    SQUARE_WEBHOOK_SIGNATURE_KEY: 'test-signature-key',
    SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://example.test/api/webhooks/square',
    ...overrides,
  };
}

test('Square stays disabled unless explicitly enabled, without requiring credentials', () => {
  for (const flag of [undefined, '', 'false', 'TRUE', '1', ' true ', '[SENSITIVE]']) {
    assert.equal(parseSquareConfig({ SQUARE_PAYMENTS_ENABLED: flag }), null);
  }
});

test('enabled configuration defaults to sandbox and keeps secrets server-side in its result', () => {
  assert.deepEqual(parseSquareConfig(environment({ SQUARE_ENVIRONMENT: undefined })), {
    environment: 'sandbox',
    accessToken: 'test-access-token',
    applicationId: 'sandbox-sq0idb-test-application',
    locationId: 'test-location',
    webhookSignatureKey: 'test-signature-key',
    webhookNotificationUrl: 'https://example.test/api/webhooks/square',
  });
});

test('production requires production application credentials', () => {
  assert.equal(parseSquareConfig(environment({
    SQUARE_ENVIRONMENT: 'production',
    SQUARE_APPLICATION_ID: 'sq0idp-production-application',
  }))?.environment, 'production');
  assert.throws(() => parseSquareConfig(environment({ SQUARE_ENVIRONMENT: 'production' })), /SQUARE_APPLICATION_ID/);
  assert.throws(() => parseSquareConfig(environment({ SQUARE_APPLICATION_ID: 'sq0idp-production-application' })), /SQUARE_APPLICATION_ID/);
});

test('enabled configuration rejects invalid environment names', () => {
  for (const value of ['', 'live', 'SANDBOX', '[SENSITIVE]']) {
    assert.throws(() => parseSquareConfig(environment({ SQUARE_ENVIRONMENT: value })), /SQUARE_ENVIRONMENT/);
  }
});

test('every required field rejects missing credentials and deployment placeholders', () => {
  for (const field of [
    'SQUARE_ACCESS_TOKEN', 'SQUARE_APPLICATION_ID', 'SQUARE_LOCATION_ID',
    'SQUARE_WEBHOOK_SIGNATURE_KEY', 'SQUARE_WEBHOOK_NOTIFICATION_URL',
  ]) {
    for (const value of [undefined, '', '   ', '[SENSITIVE]', ' [SENSITIVE] ', '<your-value>', 'REPLACE_ME']) {
      assert.throws(() => parseSquareConfig(environment({ [field]: value })), new RegExp(field));
    }
  }
});

test('credentials reject embedded whitespace that cannot be used in Square requests', () => {
  for (const field of ['SQUARE_ACCESS_TOKEN', 'SQUARE_APPLICATION_ID', 'SQUARE_LOCATION_ID', 'SQUARE_WEBHOOK_SIGNATURE_KEY']) {
    assert.throws(() => parseSquareConfig(environment({ [field]: 'private-value\nheader' })), new RegExp(field));
  }
});

test('application ids require an environment-specific prefix and a nonempty identifier', () => {
  for (const applicationId of ['sandbox-sq0idb-', 'application-id', 'sandbox-sq0idp-test']) {
    assert.throws(() => parseSquareConfig(environment({ SQUARE_APPLICATION_ID: applicationId })), /SQUARE_APPLICATION_ID/);
  }
});

test('webhook URL is HTTPS without credentials or fragment and is never silently normalised', () => {
  for (const value of [
    'http://localhost:3000/api/webhooks/square', '//example.test/hook',
    'https://user:private-password@example.test/hook', 'https://example.test/hook#fragment',
    'https://example.test/hook#', ' https://example.test/hook',
    'https://example.test/hook\n', 'https://example.test/ho ok', 'not-a-url',
  ]) {
    assert.throws(() => parseSquareConfig(environment({ SQUARE_WEBHOOK_NOTIFICATION_URL: value })), /SQUARE_WEBHOOK_NOTIFICATION_URL/);
  }
  const exactUrl = 'https://EXAMPLE.test:443/api/%73quare/?key=one%2Ftwo&x=1';
  assert.equal(parseSquareConfig(environment({ SQUARE_WEBHOOK_NOTIFICATION_URL: exactUrl }))?.webhookNotificationUrl, exactUrl);
});

test('configuration errors expose the field name without exposing supplied values', () => {
  const secretUrl = 'https://private-user:private-password@example.test/hook';
  assert.throws(() => parseSquareConfig(environment({ SQUARE_WEBHOOK_NOTIFICATION_URL: secretUrl })), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /SQUARE_WEBHOOK_NOTIFICATION_URL/);
    for (const secret of [secretUrl, 'private-password', 'test-access-token', 'test-signature-key']) {
      assert.equal(error.message.includes(secret), false);
    }
    return true;
  });
});

test('runtime configuration reads current environment on each call', async () => {
  const values = environment();
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal((await getSquareConfig())?.environment, 'sandbox');
    process.env.SQUARE_PAYMENTS_ENABLED = 'false';
    assert.equal(await getSquareConfig(), null);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
