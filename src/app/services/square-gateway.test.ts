import test from 'node:test';
import assert from 'node:assert/strict';
import type { SquareConfig } from '../lib/square-config';
import { createSquareGateway, SquareGatewayError, SQUARE_API_VERSION } from './square-gateway';

const config: SquareConfig = {
  environment: 'sandbox', accessToken: 'secret-access-token',
  applicationId: 'sandbox-sq0idb-test', locationId: 'location-1',
  webhookSignatureKey: 'secret-signature-key', webhookNotificationUrl: 'https://example.com/webhook',
};
const authorization = { sourceId: 'card-token', amountPence: 1500, idempotencyKey: 'attempt-1', referenceId: 'attempt-1' };
const expected = { paymentId: 'payment-1', amountPence: 1500, referenceId: 'attempt-1' };
function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1', status: 'APPROVED', amount_money: { amount: 1500, currency: 'GBP' },
    location_id: 'location-1', reference_id: 'attempt-1', source_type: 'CARD',
    delay_action: 'CANCEL', delayed_until: '2026-10-03T12:00:00Z', version_token: 'version-1',
    ...overrides,
  };
}
function refund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1', status: 'PENDING', payment_id: 'payment-1',
    amount_money: { amount: 500, currency: 'GBP' }, location_id: 'location-1', ...overrides,
  };
}
function harness(body: unknown, status = 200, settings: SquareConfig | null = config) {
  const requests: { url: string; init: RequestInit }[] = [];
  const gateway = createSquareGateway({
    loadConfig: async () => settings,
    transport: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return Response.json(body, { status });
    },
  });
  return { gateway, requests };
}
const isKind = (kind: SquareGatewayError['kind']) => (error: unknown) =>
  error instanceof SquareGatewayError && error.kind === kind;

test('disabled gateway never sends a payment request', async () => {
  const { gateway, requests } = harness({}, 200, null);
  await assert.rejects(gateway.authorize(authorization), isKind('disabled'));
  assert.equal(requests.length, 0);
});

test('authorization uses delayed capture, GBP, a stable attempt, and sandbox endpoint', async () => {
  const { gateway, requests } = harness({ payment: payment({ card_details: { secret: 'not-returned' } }) });
  const result = await gateway.authorize(authorization);
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.delayed_until, '2026-10-03T12:00:00Z');
  assert.equal('card_details' in result, false);
  assert.equal(requests[0].url, 'https://connect.squareupsandbox.com/v2/payments');
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    source_id: 'card-token', idempotency_key: 'attempt-1', reference_id: 'attempt-1',
    amount_money: { amount: 1500, currency: 'GBP' }, location_id: 'location-1',
    autocomplete: false, delay_action: 'CANCEL', accept_partial_authorization: false,
  });
  const headers = new Headers(requests[0].init.headers);
  assert.equal(headers.get('Square-Version'), SQUARE_API_VERSION);
  assert.equal(headers.get('Authorization'), 'Bearer secret-access-token');
  assert.equal(requests[0].init.cache, 'no-store');
  assert.equal(requests[0].init.redirect, 'error');
  assert.ok(requests[0].init.signal instanceof AbortSignal);
});

test('repeat authorization preserves the request body and caller idempotency key', async () => {
  const { gateway, requests } = harness({ payment: payment() });
  await gateway.authorize(authorization);
  await gateway.authorize(authorization);
  assert.equal(requests[0].init.body, requests[1].init.body);
});

test('explicit production config selects only the production Square host', async () => {
  const { gateway, requests } = harness({ payment: payment() }, 200, { ...config, environment: 'production' });
  await gateway.getPayment('payment-1');
  assert.equal(requests[0].url, 'https://connect.squareup.com/v2/payments/payment-1');
  assert.equal(requests[0].init.method, 'GET');
});

for (const amountPence of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid authorization amount ${amountPence} is rejected before network I/O`, async () => {
    const { gateway, requests } = harness({});
    await assert.rejects(gateway.authorize({ ...authorization, amountPence }), isKind('invalid_input'));
    assert.equal(requests.length, 0);
  });
}

test('1p is a valid UK card payment amount', async () => {
  const { gateway } = harness({ payment: payment({ amount_money: { amount: 1, currency: 'GBP' } }) });
  assert.equal((await gateway.authorize({ ...authorization, amountPence: 1 })).amount_money.amount, 1);
});

test('blank/oversized attempt identifiers and cash sources cannot authorize', async () => {
  for (const patch of [{ idempotencyKey: '' }, { idempotencyKey: 'x'.repeat(46) }, { referenceId: 'x'.repeat(41) }, { sourceId: 'CASH' }, { sourceId: 'EXTERNAL' }]) {
    const { gateway, requests } = harness({});
    await assert.rejects(gateway.authorize({ ...authorization, ...patch }), isKind('invalid_input'));
    assert.equal(requests.length, 0);
  }
});

for (const patch of [
  { status: 'COMPLETED' }, { status: 'PENDING' }, { status: 'FAILED' },
  { amount_money: { amount: 1400, currency: 'GBP' } },
  { amount_money: { amount: 1500, currency: 'USD' } },
  { location_id: 'different-location' }, { reference_id: 'different-attempt' },
  { source_type: 'CASH' }, { delay_action: 'COMPLETE' }, { delayed_until: undefined },
]) {
  test(`authorization rejects unexpected provider payment ${JSON.stringify(patch)}`, async () => {
    const { gateway } = harness({ payment: payment(patch) });
    await assert.rejects(gateway.authorize(authorization), isKind('invalid_response'));
  });
}

test('capture sends the version token and verifies completion against the expected payment', async () => {
  const { gateway, requests } = harness({ payment: payment({ status: 'COMPLETED' }) });
  assert.equal((await gateway.capture({ ...expected, versionToken: 'version-1' })).status, 'COMPLETED');
  assert.equal(requests[0].url.endsWith('/payment-1/complete'), true);
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), { version_token: 'version-1' });
});

test('capture does not report success for an approved or unrelated payment', async () => {
  for (const patch of [{}, { status: 'COMPLETED', id: 'unrelated' }, { status: 'COMPLETED', amount_money: { amount: 1, currency: 'GBP' } }]) {
    const { gateway } = harness({ payment: payment(patch) });
    await assert.rejects(gateway.capture({ ...expected, versionToken: 'version-1' }), isKind('invalid_response'));
  }
});

test('cancel checks CANCELED status and never refunds an authorization', async () => {
  const { gateway, requests } = harness({ payment: payment({ status: 'CANCELED' }) });
  assert.equal((await gateway.cancel(expected)).status, 'CANCELED');
  assert.equal(requests[0].url.endsWith('/payment-1/cancel'), true);
  assert.equal(requests[0].init.body, undefined);
});

test('cancel by idempotency key can recover creation with a lost response', async () => {
  const { gateway, requests } = harness({});
  await gateway.cancelByIdempotencyKey('attempt-1');
  assert.equal(requests[0].url.endsWith('/payments/cancel'), true);
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), { idempotency_key: 'attempt-1' });
});

test('refund preserves asynchronous status and omits location_id for linked refunds', async () => {
  const { gateway, requests } = harness({ refund: refund() });
  const result = await gateway.refund({ paymentId: 'payment-1', amountPence: 500, idempotencyKey: 'refund-attempt-1', reason: 'Customer cancellation' });
  assert.equal(result.status, 'PENDING');
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    payment_id: 'payment-1', idempotency_key: 'refund-attempt-1',
    amount_money: { amount: 500, currency: 'GBP' }, reason: 'Customer cancellation',
  });
});

test('refund rejects a response for a different payment, amount, location, or currency', async () => {
  for (const patch of [{ payment_id: 'other' }, { amount_money: { amount: 999, currency: 'GBP' } }, { location_id: 'other' }, { amount_money: { amount: 500, currency: 'USD' } }]) {
    const { gateway } = harness({ refund: refund(patch) });
    await assert.rejects(gateway.refund({ paymentId: 'payment-1', amountPence: 500, idempotencyKey: 'refund-attempt-1' }), isKind('invalid_response'));
  }
});

test('payment and refund reads preserve terminal/failure status for reconciliation', async () => {
  for (const status of ['CANCELED', 'COMPLETED', 'FAILED']) {
    const { gateway } = harness({ payment: payment({ status }) });
    assert.equal((await gateway.getPayment('payment-1')).status, status);
  }
  for (const status of ['PENDING', 'COMPLETED', 'FAILED', 'REJECTED']) {
    const { gateway } = harness({ refund: refund({ status }) });
    assert.equal((await gateway.getRefund('refund-1')).status, status);
  }
});

test('read operations reject mismatched resource IDs', async () => {
  const { gateway } = harness({ payment: payment(), refund: refund() });
  await assert.rejects(gateway.getPayment('other'), isKind('invalid_response'));
  await assert.rejects(gateway.getRefund('other'), isKind('invalid_response'));
});

test('refund identifiers support Square’s documented 255-character limit', async () => {
  const refundId = 'r'.repeat(255);
  const { gateway, requests } = harness({ refund: refund({ id: refundId }) });
  assert.equal((await gateway.refund({ paymentId: 'payment-1', amountPence: 500, idempotencyKey: 'refund-attempt-1' })).id, refundId);
  assert.equal((await gateway.getRefund(refundId)).id, refundId);
  assert.equal(requests[1].url.endsWith(`/refunds/${refundId}`), true);
  await assert.rejects(gateway.getRefund('r'.repeat(256)), isKind('invalid_input'));
});

test('provider identifiers are opaque and safely encoded into URL paths', async () => {
  const paymentId = 'provider/id?query=value';
  const { gateway, requests } = harness({ payment: payment({ id: paymentId }) });
  assert.equal((await gateway.getPayment(paymentId)).id, paymentId);
  assert.equal(requests[0].url, 'https://connect.squareupsandbox.com/v2/payments/provider%2Fid%3Fquery%3Dvalue');
});

test('provider errors expose no access token, card token, or raw error detail', async () => {
  const { gateway } = harness({ errors: [{ code: 'CARD_DECLINED', detail: 'secret-access-token card-token private info' }] }, 400);
  await assert.rejects(gateway.authorize(authorization), (error: unknown) => {
    assert.ok(error instanceof SquareGatewayError);
    assert.equal(error.kind, 'provider_error');
    assert.equal(error.httpStatus, 400);
    assert.doesNotMatch(String(error) + JSON.stringify(error), /secret-access-token|card-token|private info/);
    return true;
  });
});

test('server errors are ambiguous outcomes, never retried automatically', async () => {
  const { gateway, requests } = harness({}, 503);
  await assert.rejects(gateway.authorize(authorization), isKind('unknown_outcome'));
  assert.equal(requests.length, 1);
});

test('network timeout is ambiguous and does not trigger a second authorization', async () => {
  let calls = 0;
  const gateway = createSquareGateway({ loadConfig: async () => config, transport: async () => {
    calls++;
    throw new DOMException('private provider detail', 'TimeoutError');
  } });
  await assert.rejects(gateway.authorize(authorization), isKind('unknown_outcome'));
  assert.equal(calls, 1);
});

test('malformed JSON, missing payment, and errors inside 2xx never count as success', async () => {
  const transport = async () => new Response('not JSON');
  await assert.rejects(createSquareGateway({ loadConfig: async () => config, transport }).authorize(authorization), isKind('invalid_response'));
  for (const body of [{}, { errors: [{ code: 'DECLINED' }], payment: payment() }]) {
    await assert.rejects(harness(body).gateway.authorize(authorization), isKind('invalid_response'));
  }
});

test('runtime config is reloaded for each operation, so disabling stops further I/O', async () => {
  let current: SquareConfig | null = config;
  let calls = 0;
  const gateway = createSquareGateway({ loadConfig: async () => current, transport: async () => {
    calls++;
    return Response.json({ payment: payment() });
  } });
  await gateway.getPayment('payment-1');
  current = null;
  await assert.rejects(gateway.getPayment('payment-1'), isKind('disabled'));
  assert.equal(calls, 1);
});
