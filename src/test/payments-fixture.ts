import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { SquareGatewayError, type SquarePayment, type SquareRefund } from '../app/services/square-gateway';

/**
 * Phase S4 (docs/superpowers/specs/2026-10-13-square-deposits-design.md): the
 * payment tables as a small in-memory database that answers the Prisma
 * calls the webhook, reconciliation, attention lists and Operations page
 * make — equality, null, in, not (SQL: NULL never matches), lt/lte/gt/gte,
 * OR/AND/NOT, the relation filters `is` / `none`, nested selects with their
 * own where/orderBy/take, @updatedAt, unique columns (P2002) and
 * transactions that roll back when they throw — plus a fake Square that
 * behaves like Square: a hold is APPROVED until captured (COMPLETED) or
 * cancelled, cancel-by-key answers {} whether or not anything matched, and a
 * refund asked for again with the same key returns the same refund.
 */

export const NOW = new Date('2099-09-01T12:00:00Z');
export const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
export const CONFIG = {
  environment: 'sandbox' as const, accessToken: 'sandbox-token', applicationId: 'sandbox-sq0idb-fixture', locationId: 'fixture-location',
  webhookSignatureKey: 'fixture-signature-key', webhookNotificationUrl: 'https://www.example.test/api/webhooks/square',
};

export type AttemptRow = {
  id: string; userId: string | null; attemptKey: string; idempotencyKey: string; appointmentId: string | null; status: string;
  environment: string; locationId: string; amountPence: number; currency: string; quoteAmountPence: number; policyJson: string;
  requestJson: string; squarePaymentId: string | null; delayedUntil: Date | null; authorizedAt: Date | null; capturedAt: Date | null;
  voidedAt: Date | null; lastError: string | null; createdAt: Date; updatedAt: Date;
};
export type RefundRow = {
  id: string; attemptId: string; idempotencyKey: string; squareRefundId: string | null; amountPence: number; status: string;
  reason: string; requestedById: string | null; createdAt: Date; updatedAt: Date;
};
export type EventRow = { eventId: string; type: string; objectId: string | null; receivedAt: Date; processedAt: Date | null };
export type AppointmentRow = { id: string; status: string; date: Date };
export type AuditRow = { actorUserId: string | null; action: string; targetType: string; targetId: string | null; metadata: Record<string, unknown> };

type Row = Record<string, unknown>;
type Model = 'paymentAttempt' | 'paymentRefund' | 'squareWebhookEvent' | 'appointment';
type Tables = { paymentAttempt: AttemptRow[]; paymentRefund: RefundRow[]; squareWebhookEvent: EventRow[]; appointment: AppointmentRow[]; audit: AuditRow[] };

const UNIQUE: Record<Model, string[]> = {
  paymentAttempt: ['id', 'idempotencyKey', 'squarePaymentId', 'appointmentId'],
  paymentRefund: ['id', 'idempotencyKey', 'squareRefundId'],
  squareWebhookEvent: ['eventId'],
  appointment: ['id'],
};

export function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'fixture' });
}

/** An attempt row with every column, the deposit S2 leaves behind by default (a £20 hold on a request). */
export function attempt(values: Partial<AttemptRow> & { id: string }): AttemptRow {
  return {
    userId: 'user-1', attemptKey: `key-${values.id}`, idempotencyKey: `dep_${values.id}`, appointmentId: null, status: 'AUTHORIZED',
    environment: CONFIG.environment, locationId: CONFIG.locationId, amountPence: 2000, currency: 'GBP', quoteAmountPence: 10000,
    policyJson: '{}', requestJson: '{}', squarePaymentId: `pay-${values.id}`, delayedUntil: minutes(5 * 24 * 60), authorizedAt: minutes(-24 * 60),
    capturedAt: null, voidedAt: null, lastError: null, createdAt: minutes(-24 * 60), updatedAt: minutes(-24 * 60), ...values,
  };
}

export function refund(values: Partial<RefundRow> & { id: string; attemptId: string }): RefundRow {
  return {
    idempotencyKey: `rfd_${values.id}`, squareRefundId: null, amountPence: 2000, status: 'REQUESTED', reason: 'STAFF_CANCELLED',
    requestedById: null, createdAt: minutes(-24 * 60), updatedAt: minutes(-24 * 60), ...values,
  };
}

export function paymentsDb(seed: { appointments?: AppointmentRow[]; attempts?: AttemptRow[]; refunds?: RefundRow[]; events?: EventRow[]; now?: () => Date } = {}) {
  const now = seed.now ?? (() => NOW);
  const tables: Tables = {
    paymentAttempt: seed.attempts ?? [], paymentRefund: seed.refunds ?? [], squareWebhookEvent: seed.events ?? [],
    appointment: seed.appointments ?? [], audit: [],
  };
  const calls: { model: string; method: string; args: unknown }[] = [];
  /** Run once before a matching call: throw to make the database fail there. */
  const faults: { model: string; method: string; error: Error; times: number }[] = [];
  let sequence = 0;

  const relations: Record<Model, Record<string, { model: Model; many: boolean; get: (row: Row) => Row | null | Row[] }>> = {
    paymentAttempt: {
      appointment: { model: 'appointment', many: false, get: (row) => tables.appointment.find((a) => a.id === row.appointmentId) ?? null },
      refunds: { model: 'paymentRefund', many: true, get: (row) => tables.paymentRefund.filter((r) => r.attemptId === row.id) },
    },
    paymentRefund: {
      attempt: { model: 'paymentAttempt', many: false, get: (row) => tables.paymentAttempt.find((a) => a.id === row.attemptId) ?? null },
    },
    squareWebhookEvent: {},
    appointment: {},
  };

  const compare = (a: unknown, b: unknown) => {
    const x = a instanceof Date ? a.getTime() : (a as number | string);
    const y = b instanceof Date ? b.getTime() : (b as number | string);
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
  function fieldMatches(value: unknown, condition: unknown): boolean {
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date || typeof condition !== 'object') return value !== null && value !== undefined && same(value, condition);
    return Object.entries(condition as Row).every(([op, operand]) => {
      const present = value !== null && value !== undefined;
      switch (op) {
        case 'equals': return fieldMatches(value, operand);
        case 'in': return present && (operand as unknown[]).some((item) => same(item, value));
        case 'notIn': return present && !(operand as unknown[]).some((item) => same(item, value));
        // SQL: `col <> x` is never true for NULL (Prisma's `not` behaves the same).
        case 'not': return operand === null ? present : present && !fieldMatches(value, operand);
        case 'lt': return present && compare(value, operand) < 0;
        case 'lte': return present && compare(value, operand) <= 0;
        case 'gt': return present && compare(value, operand) > 0;
        case 'gte': return present && compare(value, operand) >= 0;
        default: throw new Error(`payments-fixture: unsupported operator ${op}`);
      }
    });
  }
  function matches(model: Model, row: Row, where: Row | undefined): boolean {
    return Object.entries(where ?? {}).every(([key, condition]) => {
      if (key === 'OR') return (condition as Row[]).some((alternative) => matches(model, row, alternative));
      if (key === 'AND') return ([] as Row[]).concat(condition as Row[]).every((part) => matches(model, row, part));
      if (key === 'NOT') return !([] as Row[]).concat(condition as Row[]).some((part) => matches(model, row, part));
      const relation = relations[model][key];
      if (relation) {
        const target = relation.get(row);
        const filter = condition as Row;
        if (relation.many) {
          const list = target as Row[];
          if ('none' in filter) return !list.some((item) => matches(relation.model, item, filter.none as Row));
          if ('some' in filter) return list.some((item) => matches(relation.model, item, filter.some as Row));
          if ('every' in filter) return list.every((item) => matches(relation.model, item, filter.every as Row));
          throw new Error(`payments-fixture: unsupported list filter on ${key}`);
        }
        const one = target as Row | null;
        if (filter === null) return one === null;
        if ('is' in filter) return filter.is === null ? one === null : one !== null && matches(relation.model, one, filter.is as Row);
        if ('isNot' in filter) return filter.isNot === null ? one !== null : one === null || !matches(relation.model, one, filter.isNot as Row);
        return one !== null && matches(relation.model, one, filter);
      }
      return fieldMatches(row[key], condition);
    });
  }
  function sort<T extends Row>(rows: T[], orderBy: unknown): T[] {
    const keys = ([] as Row[]).concat((orderBy as Row[] | Row | undefined) ?? []);
    return [...rows].sort((a, b) => {
      for (const key of keys) {
        const [field, direction] = Object.entries(key)[0];
        const order = compare(a[field], b[field]);
        if (order !== 0) return direction === 'desc' ? -order : order;
      }
      return 0;
    });
  }
  const copy = (value: unknown): unknown => (value instanceof Date ? new Date(value.getTime()) : value);
  function project(model: Model, row: Row, select: Row | undefined): Row {
    if (!select) return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, copy(value)]));
    const out: Row = {};
    for (const [key, spec] of Object.entries(select)) {
      if (!spec) continue;
      const relation = relations[model][key];
      if (!relation) {
        out[key] = copy(row[key]);
        continue;
      }
      const nested = spec === true ? undefined : (spec as Row);
      if (relation.many) {
        let list = relation.get(row) as Row[];
        if (nested?.where) list = list.filter((item) => matches(relation.model, item, nested.where as Row));
        list = sort(list, nested?.orderBy);
        if (nested?.take !== undefined) list = list.slice(0, nested.take as number);
        out[key] = list.map((item) => project(relation.model, item, nested?.select as Row | undefined));
      } else {
        const one = relation.get(row) as Row | null;
        out[key] = one ? project(relation.model, one, nested?.select as Row | undefined) : null;
      }
    }
    return out;
  }
  function checkUnique(model: Model, row: Row, others: Row[]) {
    for (const column of UNIQUE[model]) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      if (others.some((other) => other !== row && other[column] === value)) throw uniqueViolation();
    }
  }
  function record(model: string, method: string, args: unknown) {
    calls.push({ model, method, args });
    const fault = faults.find((entry) => entry.model === model && entry.method === method && entry.times > 0);
    if (fault) {
      fault.times--;
      throw fault.error;
    }
  }

  function delegate(model: Model) {
    const rows = () => tables[model] as unknown as Row[];
    return {
      findUnique: async (args: { where: Row; select?: Row }) => {
        record(model, 'findUnique', args);
        const row = rows().find((candidate) => matches(model, candidate, args.where));
        return row ? project(model, row, args.select) : null;
      },
      findFirst: async (args: { where?: Row; select?: Row; orderBy?: unknown } = {}) => {
        record(model, 'findFirst', args);
        const row = sort(rows().filter((candidate) => matches(model, candidate, args.where)), args.orderBy)[0];
        return row ? project(model, row, args.select) : null;
      },
      findMany: async (args: { where?: Row; select?: Row; orderBy?: unknown; take?: number } = {}) => {
        record(model, 'findMany', args);
        const found = sort(rows().filter((candidate) => matches(model, candidate, args.where)), args.orderBy);
        return found.slice(0, args.take ?? found.length).map((row) => project(model, row, args.select));
      },
      count: async (args: { where?: Row } = {}) => {
        record(model, 'count', args);
        return rows().filter((candidate) => matches(model, candidate, args.where)).length;
      },
      updateMany: async (args: { where: Row; data: Row }) => {
        record(model, 'updateMany', args);
        const matched = rows().filter((candidate) => matches(model, candidate, args.where));
        for (const row of matched) {
          const before = { ...row };
          Object.assign(row, args.data);
          // @updatedAt, as Prisma sets it on every update.
          if ('updatedAt' in row && !('updatedAt' in args.data)) row.updatedAt = now();
          try {
            checkUnique(model, row, rows());
          } catch (error) {
            Object.assign(row, before);
            throw error;
          }
        }
        return { count: matched.length };
      },
      create: async (args: { data: Row; select?: Row }) => {
        record(model, 'create', args);
        const stamp = now();
        const defaults: Record<Model, Row> = {
          paymentRefund: { id: `refund-${++sequence}`, squareRefundId: null, requestedById: null, createdAt: stamp, updatedAt: stamp },
          squareWebhookEvent: { receivedAt: stamp, processedAt: null, objectId: null },
          paymentAttempt: { createdAt: stamp, updatedAt: stamp },
          appointment: {},
        };
        const row = { ...defaults[model], ...args.data };
        checkUnique(model, row, [...rows(), row]);
        rows().push(row);
        return project(model, row, args.select);
      },
    };
  }

  const client = {
    paymentAttempt: delegate('paymentAttempt'),
    paymentRefund: delegate('paymentRefund'),
    squareWebhookEvent: delegate('squareWebhookEvent'),
    appointment: delegate('appointment'),
    auditEvent: {
      create: async (args: { data: { actorUserId: string | null; action: string; targetType: string; targetId: string | null; metadataJson: string } }) => {
        record('auditEvent', 'create', args);
        tables.audit.push({ actorUserId: args.data.actorUserId, action: args.data.action, targetType: args.data.targetType, targetId: args.data.targetId, metadata: JSON.parse(args.data.metadataJson) });
        return { id: `audit-${tables.audit.length}` };
      },
    },
  };
  const db = {
    ...client,
    /** Interactive transactions: everything written inside is undone when the callback throws. */
    $transaction: async <T>(fn: (tx: typeof client) => Promise<T>): Promise<T> => {
      record('$transaction', 'run', null);
      const snapshot = structuredClone(tables);
      try {
        return await fn(client);
      } catch (error) {
        for (const key of Object.keys(tables) as (keyof Tables)[]) {
          (tables[key] as unknown[]).splice(0, tables[key].length, ...(snapshot[key] as unknown[]));
        }
        throw error;
      }
    },
  };

  const writes = (model: string) => calls.filter((call) => call.model === model && (call.method === 'updateMany' || call.method === 'create')).length;
  return {
    db, tables, calls, faults, writes,
    attempt: (id: string) => tables.paymentAttempt.find((row) => row.id === id)!,
    refunds: (attemptId: string) => tables.paymentRefund.filter((row) => row.attemptId === attemptId),
    event: (eventId: string) => tables.squareWebhookEvent.find((row) => row.eventId === eventId),
  };
}

type PaymentState = { id: string; status: SquarePayment['status']; amount: number; referenceId: string; version: number; locationId: string; delayedUntil: string };
type Override<A extends unknown[], R> = (real: () => Promise<R>, ...args: A) => Promise<R>;

/** A fake Square: payments by id, refunds by idempotency key (asking again returns the same refund). */
export function fakeSquare() {
  const payments = new Map<string, PaymentState>();
  const refundsByKey = new Map<string, SquareRefund>();
  const calls = {
    getPayment: [] as string[], cancel: [] as string[], cancelByKey: [] as string[], capture: [] as string[],
    refund: [] as { paymentId: string; amountPence: number; idempotencyKey: string; reason?: string }[], getRefund: [] as string[],
    order: [] as string[],
  };
  const script: {
    getPayment?: Override<[string], SquarePayment>;
    cancel?: Override<[{ paymentId: string }], SquarePayment>;
    cancelByIdempotencyKey?: Override<[string], void>;
    refund?: Override<[{ paymentId: string; amountPence: number; idempotencyKey: string }], SquareRefund>;
    getRefund?: Override<[string], SquareRefund>;
  } = {};
  const asPayment = (state: PaymentState): SquarePayment => ({
    id: state.id, status: state.status, amount_money: { amount: state.amount, currency: 'GBP' }, location_id: state.locationId,
    source_type: 'CARD', reference_id: state.referenceId, version_token: `v${state.version}`, delay_action: 'CANCEL', delayed_until: state.delayedUntil,
  });
  const lookup = (id: string) => {
    const state = payments.get(id);
    if (!state) throw new SquareGatewayError('provider_error', 404);
    return state;
  };
  const gateway = {
    authorize: async (): Promise<SquarePayment> => { throw new Error('payments-fixture: authorize is not part of S4'); },
    getPayment: async (id: string) => {
      calls.getPayment.push(id);
      calls.order.push(`getPayment:${id}`);
      const real = async () => asPayment(lookup(id));
      return script.getPayment ? script.getPayment(real, id) : real();
    },
    cancel: async (input: { paymentId: string; amountPence: number; referenceId: string }) => {
      calls.cancel.push(input.paymentId);
      calls.order.push(`cancel:${input.paymentId}`);
      const real = async () => {
        const state = lookup(input.paymentId);
        if (state.status !== 'APPROVED') throw new SquareGatewayError('provider_error', 400);
        state.status = 'CANCELED';
        state.version++;
        return asPayment(state);
      };
      return script.cancel ? script.cancel(real, input) : real();
    },
    cancelByIdempotencyKey: async (key: string) => {
      calls.cancelByKey.push(key);
      calls.order.push(`cancelByKey:${key}`);
      const real = async () => undefined;
      return script.cancelByIdempotencyKey ? script.cancelByIdempotencyKey(real, key) : real();
    },
    capture: async (input: { paymentId: string }): Promise<SquarePayment> => {
      calls.capture.push(input.paymentId);
      throw new Error('payments-fixture: S4 never captures');
    },
    refund: async (input: { paymentId: string; amountPence: number; idempotencyKey: string; reason?: string }) => {
      calls.refund.push(input);
      calls.order.push(`refund:${input.idempotencyKey}`);
      const real = async (): Promise<SquareRefund> => {
        const existing = refundsByKey.get(input.idempotencyKey);
        if (existing) return { ...existing };
        const created: SquareRefund = {
          id: `sq-refund-${input.idempotencyKey}`, payment_id: input.paymentId, location_id: CONFIG.locationId, status: 'PENDING',
          amount_money: { amount: input.amountPence, currency: 'GBP' },
        };
        refundsByKey.set(input.idempotencyKey, created);
        return { ...created };
      };
      return script.refund ? script.refund(real, input) : real();
    },
    getRefund: async (id: string) => {
      calls.getRefund.push(id);
      const real = async (): Promise<SquareRefund> => {
        const found = [...refundsByKey.values()].find((candidate) => candidate.id === id);
        if (!found) throw new SquareGatewayError('provider_error', 404);
        return { ...found };
      };
      return script.getRefund ? script.getRefund(real, id) : real();
    },
  };
  return {
    gateway, payments, refundsByKey, calls, script,
    /** Square's side of a deposit. */
    hold(id: string, referenceId: string, status: SquarePayment['status'] = 'APPROVED', amount = 2000) {
      payments.set(id, { id, status, amount, referenceId, version: 1, locationId: CONFIG.locationId, delayedUntil: minutes(5 * 24 * 60).toISOString() });
    },
    /** A refund Square already has under this key (its status can then move). */
    knownRefund(idempotencyKey: string, paymentId: string, status: SquareRefund['status'], amount = 2000) {
      refundsByKey.set(idempotencyKey, { id: `sq-refund-${idempotencyKey}`, payment_id: paymentId, location_id: CONFIG.locationId, status, amount_money: { amount, currency: 'GBP' } });
    },
  };
}

/** A Square webhook body for a payment, as Square sends it. */
export function paymentEvent(eventId: string, type: 'payment.created' | 'payment.updated', payment: { id: string; status: string; amount?: number; referenceId?: string | null; locationId?: string }) {
  return JSON.stringify({
    merchant_id: 'MERCHANT', type, event_id: eventId, created_at: '2099-09-01T12:00:00Z',
    data: {
      type: 'payment', id: payment.id,
      object: {
        payment: {
          id: payment.id, status: payment.status, amount_money: { amount: payment.amount ?? 2000, currency: 'GBP' },
          location_id: payment.locationId ?? CONFIG.locationId, source_type: 'CARD',
          ...(payment.referenceId === null ? {} : { reference_id: payment.referenceId ?? 'missing' }),
          card_details: { status: 'AUTHORIZED', card: { last_4: '1111' } },
        },
      },
    },
  });
}

/** A Square webhook body for a refund. */
export function refundEvent(eventId: string, type: 'refund.created' | 'refund.updated', value: { id: string; status: string; paymentId: string; amount?: number; locationId?: string }) {
  return JSON.stringify({
    merchant_id: 'MERCHANT', type, event_id: eventId, created_at: '2099-09-01T12:00:00Z',
    data: {
      type: 'refund', id: value.id,
      object: {
        refund: {
          id: value.id, status: value.status, payment_id: value.paymentId, amount_money: { amount: value.amount ?? 2000, currency: 'GBP' },
          location_id: value.locationId ?? CONFIG.locationId,
        },
      },
    },
  });
}

/** Square's signature: HMAC-SHA256 of the subscription URL followed by the exact body, Base64. */
export function sign(body: string, url = CONFIG.webhookNotificationUrl, key = CONFIG.webhookSignatureKey): string {
  return createHmac('sha256', key).update(url).update(body).digest('base64');
}
