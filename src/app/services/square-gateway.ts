import 'server-only';

// STATUS: NOT WIRED. Square deposit foundation only — nothing in the booking
// flow calls this yet, and production online booking is locked closed until it
// does. See lib/online-booking-lock.ts (SQUARE_DEPOSITS_WIRED).

import { z } from 'zod';
import { getSquareConfig, type SquareConfig } from '../lib/square-config';

export const SQUARE_API_VERSION = '2026-09-16';

const pence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().min(1).max(192).refine((value) => value.trim().length > 0);
const refundIdentifier = z.string().min(1).max(255).refine((value) => value.trim().length > 0);
const idempotencyKey = z.string().min(1).max(45).regex(/^[A-Za-z0-9_-]+$/);
const referenceId = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);
const versionToken = z.string().min(1).max(192);
const money = z.object({ amount: pence, currency: z.literal('GBP') });
const paymentSchema = z.object({
  id: identifier,
  status: z.enum(['APPROVED', 'PENDING', 'COMPLETED', 'CANCELED', 'FAILED']),
  amount_money: money,
  location_id: identifier,
  source_type: z.literal('CARD'),
  reference_id: referenceId.optional(),
  version_token: versionToken.optional(),
  delayed_until: z.iso.datetime({ offset: true }).optional(),
  delay_action: z.enum(['CANCEL', 'COMPLETE']).optional(),
  updated_at: z.iso.datetime({ offset: true }).optional(),
});
const refundSchema = z.object({
  id: refundIdentifier,
  payment_id: identifier,
  location_id: identifier,
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REJECTED']),
  amount_money: money,
  updated_at: z.iso.datetime({ offset: true }).optional(),
});

/** Provider DTOs deliberately exclude card details and personal information. */
export type SquarePayment = z.infer<typeof paymentSchema>;
export type SquareRefund = z.infer<typeof refundSchema>;

/** Any error after submission needs reconciliation, including invalid responses. */
export class SquareGatewayError extends Error {
  constructor(
    public readonly kind: 'disabled' | 'invalid_input' | 'provider_error' | 'unknown_outcome' | 'invalid_response',
    public readonly httpStatus?: number,
  ) {
    super(`Square payment operation: ${kind}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
    this.name = 'SquareGatewayError';
  }
}

function validate<T>(schema: z.ZodType<T>, value: unknown, kind: 'invalid_input' | 'invalid_response'): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SquareGatewayError(kind);
  return result.data;
}

type PaymentExpectation = { paymentId: string; amountPence: number; referenceId: string };
const expectationSchema = z.object({ paymentId: identifier, amountPence: pence, referenceId });

/**
 * Payment transport foundation only: no booking mutations or automatic retries.
 * The caller must persist an attempt/key before authorizing and reconcile an
 * unknown outcome with that SAME attempt. Never call inside a retried DB tx.
 * Dependencies allow offline contract tests without a Square account.
 */
export function createSquareGateway(dependencies: {
  loadConfig?: () => Promise<SquareConfig | null>;
  transport?: typeof fetch;
} = {}) {
  const loadConfig = dependencies.loadConfig ?? getSquareConfig;
  const transport = dependencies.transport ?? fetch;

  async function request(path: string, method: 'GET' | 'POST', makeBody?: (config: SquareConfig) => unknown) {
    // Read at operation time: no credentials in build output or browser props.
    const config = await loadConfig();
    if (!config) throw new SquareGatewayError('disabled');
    const baseUrl = config.environment === 'sandbox'
      ? 'https://connect.squareupsandbox.com/v2'
      : 'https://connect.squareup.com/v2';
    let response: Response;
    try {
      response = await transport(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
          'Square-Version': SQUARE_API_VERSION,
        },
        ...(makeBody ? { body: JSON.stringify(makeBody(config)) } : {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // A timeout does NOT prove that Square declined or failed to charge.
      throw new SquareGatewayError('unknown_outcome');
    }
    if (!response.ok) {
      throw new SquareGatewayError(
        response.status >= 500 || response.status === 408 || response.status === 429
          ? 'unknown_outcome' : 'provider_error',
        response.status,
      );
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new SquareGatewayError('invalid_response');
    }
    const envelope = validate(z.object({ errors: z.array(z.unknown()).max(0).optional() }).loose(), raw, 'invalid_response');
    return { envelope, config };
  }

  function readPayment(envelope: Record<string, unknown>, config: SquareConfig, expected?: Partial<PaymentExpectation>) {
    const result = validate(paymentSchema, envelope.payment, 'invalid_response');
    if (
      result.location_id !== config.locationId ||
      (expected?.paymentId !== undefined && result.id !== expected.paymentId) ||
      (expected?.amountPence !== undefined && result.amount_money.amount !== expected.amountPence) ||
      (expected?.referenceId !== undefined && result.reference_id !== expected.referenceId)
    ) throw new SquareGatewayError('invalid_response');
    return result;
  }

  function readRefund(envelope: Record<string, unknown>, config: SquareConfig) {
    const result = validate(refundSchema, envelope.refund, 'invalid_response');
    if (result.location_id !== config.locationId) throw new SquareGatewayError('invalid_response');
    return result;
  }

  return {
    async authorize(input: { sourceId: string; amountPence: number; idempotencyKey: string; referenceId: string }): Promise<SquarePayment> {
      const data = validate(z.object({
        sourceId: z.string().min(1).max(192).refine((value) => !/\s/.test(value) && value !== 'CASH' && value !== 'EXTERNAL'),
        amountPence: pence, idempotencyKey, referenceId,
      }), input, 'invalid_input');
      const { envelope, config } = await request('/payments', 'POST', (config) => ({
        source_id: data.sourceId,
        idempotency_key: data.idempotencyKey,
        reference_id: data.referenceId,
        amount_money: { amount: data.amountPence, currency: 'GBP' },
        location_id: config.locationId,
        autocomplete: false,
        delay_action: 'CANCEL',
        accept_partial_authorization: false,
      }));
      const result = readPayment(envelope, config, data);
      if (result.status !== 'APPROVED' || result.delay_action !== 'CANCEL' || !result.delayed_until) {
        throw new SquareGatewayError('invalid_response');
      }
      return result;
    },

    async getPayment(paymentId: string): Promise<SquarePayment> {
      validate(identifier, paymentId, 'invalid_input');
      const { envelope, config } = await request(`/payments/${encodeURIComponent(paymentId)}`, 'GET');
      return readPayment(envelope, config, { paymentId });
    },

    async capture(input: PaymentExpectation & { versionToken: string }): Promise<SquarePayment> {
      const data = validate(expectationSchema.extend({ versionToken }), input, 'invalid_input');
      const { envelope, config } = await request(`/payments/${encodeURIComponent(data.paymentId)}/complete`, 'POST', () => ({ version_token: data.versionToken }));
      const result = readPayment(envelope, config, data);
      if (result.status !== 'COMPLETED') throw new SquareGatewayError('invalid_response');
      return result;
    },

    async cancel(input: PaymentExpectation): Promise<SquarePayment> {
      const data = validate(expectationSchema, input, 'invalid_input');
      const { envelope, config } = await request(`/payments/${encodeURIComponent(data.paymentId)}/cancel`, 'POST');
      const result = readPayment(envelope, config, data);
      if (result.status !== 'CANCELED') throw new SquareGatewayError('invalid_response');
      return result;
    },

    async cancelByIdempotencyKey(key: string): Promise<void> {
      validate(idempotencyKey, key, 'invalid_input');
      // Square also returns {} when no payment matches. Success here is not
      // proof that a known payment has reached CANCELED; reconcile separately.
      await request('/payments/cancel', 'POST', () => ({ idempotency_key: key }));
    },

    async refund(input: { paymentId: string; amountPence: number; idempotencyKey: string; reason?: string }): Promise<SquareRefund> {
      const data = validate(z.object({
        paymentId: identifier, amountPence: pence, idempotencyKey, reason: z.string().max(192).optional(),
      }), input, 'invalid_input');
      const { envelope, config } = await request('/refunds', 'POST', () => ({
        payment_id: data.paymentId,
        idempotency_key: data.idempotencyKey,
        amount_money: { amount: data.amountPence, currency: 'GBP' },
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
      }));
      const result = readRefund(envelope, config);
      if (result.payment_id !== data.paymentId || result.amount_money.amount !== data.amountPence) {
        throw new SquareGatewayError('invalid_response');
      }
      // PENDING is intentionally not converted to COMPLETED or "refunded".
      return result;
    },

    async getRefund(refundId: string): Promise<SquareRefund> {
      validate(refundIdentifier, refundId, 'invalid_input');
      const { envelope, config } = await request(`/refunds/${encodeURIComponent(refundId)}`, 'GET');
      const result = readRefund(envelope, config);
      if (result.id !== refundId) throw new SquareGatewayError('invalid_response');
      return result;
    },
  };
}
