import { loadServerModule } from './load-server-module';
import { appointmentEmailContent, type AppointmentEmailKind, type EmailAppointment, type EmailContent } from '../app/services/email-content';
import { SquareGatewayError, type SquarePayment, type SquareRefund } from '../app/services/square-gateway';
import { BookingError, SlotUnavailableError } from '../app/services/booking-errors';
import type { Locale } from '../i18n/config';

/**
 * One booking and its card deposit, for the phase-S3 money lifecycle
 * (docs/superpowers/specs/2026-10-13-square-deposits-design.md): the REAL
 * admin and customer actions, deposit lifecycle, payment-attempt and refund
 * services and notification outbox, over a small stateful fake database and a
 * fake Square that behaves like Square (a hold is APPROVED until it is
 * captured — COMPLETED — or cancelled; captures need the current version
 * token). Each fake transaction keeps its own undo log, so a transaction that
 * throws rolls back its own writes and nobody else's — two staff confirming at
 * once interleave as two real transactions would around a conditional write.
 */

export const NOW = new Date('2099-09-01T12:00:00Z');
export const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
export const SANDBOX_CONFIG = {
  environment: 'sandbox' as const, accessToken: 'sandbox-token', applicationId: 'sandbox-sq0idb-fixture', locationId: 'fixture-location',
  webhookSignatureKey: 'signature-key', webhookNotificationUrl: 'https://example.test/api/webhooks/square',
};

export type AttemptRow = {
  id: string; appointmentId: string | null; userId: string | null; status: string; amountPence: number; squarePaymentId: string | null;
  delayedUntil: Date | null; environment: string; locationId: string; updatedAt: Date; capturedAt: Date | null; voidedAt: Date | null; lastError: string | null;
};
export type RefundRow = {
  id: string; attemptId: string; idempotencyKey: string; squareRefundId: string | null; amountPence: number; status: string;
  reason: string; requestedById: string | null; createdAt: Date; updatedAt: Date;
};
type SquareState = { id: string; status: SquarePayment['status']; amount: number; referenceId: string; version: number; delayedUntil: string };
type CaptureInput = { paymentId: string; amountPence: number; referenceId: string; versionToken: string };
type ReleaseInput = { paymentId: string; amountPence: number; referenceId: string };
type RefundInput = { paymentId: string; amountPence: number; idempotencyKey: string; reason?: string };

/** How the fake Square answers, when a test needs it to misbehave. `real` runs Square's own behaviour. */
export type SquareScript = {
  getPayment?: (paymentId: string, real: () => SquarePayment) => Promise<SquarePayment>;
  capture?: (input: CaptureInput, real: () => SquarePayment) => Promise<SquarePayment>;
  cancel?: (input: ReleaseInput, real: () => SquarePayment) => Promise<SquarePayment>;
  refund?: (input: RefundInput, real: () => SquareRefund) => Promise<SquareRefund>;
};

export type DepositFixtureOptions = {
  /** The booking: PENDING (a request) or CONFIRMED, and when. */
  status?: string;
  date?: Date;
  /** Its card deposit; null = none (staff-entered, deposit 0, older bookings). */
  deposit?: Partial<AttemptRow> | null;
  /** Square's side of that deposit (default: the hold, APPROVED; COMPLETED once the attempt is CAPTURED). */
  squareStatus?: SquarePayment['status'];
  /** Refunds already recorded against the deposit. */
  refunds?: Partial<RefundRow>[];
  square?: SquareScript;
  /** No usable Square configuration on this deployment. */
  paymentsOff?: boolean;
  /** The customer was told the request awaits confirmation (a REQUEST_RECEIVED notice exists). */
  announced?: boolean;
  /** The time is no longer free on the Nth slot check (1-based); every other check passes. */
  slotLostOnCheck?: number;
  /** Runs inside each feed refresh before an approval (two approvals racing). */
  onFeedRefresh?: () => Promise<void> | void;
  /** Fail the transaction that confirms after the deposit was taken (the Nth transaction, 1-based). */
  failTransaction?: number;
  locale?: Locale;
  /** The customer's own session for the customer actions (default: the booking's owner). */
  customerId?: string;
};

export function depositFixture(options: DepositFixtureOptions = {}) {
  const booking = {
    id: 'appointment-1', userId: 'user-1', stylistId: 'stylist-1', serviceId: 'service-1',
    date: options.date ?? minutes(10 * 24 * 60), status: options.status ?? 'PENDING',
    durationAtBooking: 60, priceAtBooking: '100.00', quoteJson: null as string | null, notificationVersion: 0, notes: null as string | null,
    notificationLocale: 'en-GB', updatedAt: minutes(-24 * 60), treatwellBookingId: null as string | null,
    treatwellSyncStatus: 'NOT_REQUIRED', treatwellSyncError: null as string | null, reminderSent: false,
    rescheduleRequestedDate: null as Date | null, rescheduleRequestedAt: null as Date | null,
    user: { email: 'customer@example.test', name: 'Mei', phone: null as string | null },
    stylist: { name: 'Ivan', treatwellExternalId: null as string | null },
    service: { id: 'service-1', name: 'Cut', price: '100.00', duration: 60, treatwellExternalId: null as string | null },
  };
  const attempts: AttemptRow[] = options.deposit === null ? [] : [{
    id: 'attempt-1', appointmentId: booking.id, userId: booking.userId, status: 'AUTHORIZED', amountPence: 2000,
    squarePaymentId: 'square-payment-1', delayedUntil: minutes(5 * 24 * 60), environment: 'sandbox', locationId: 'fixture-location',
    updatedAt: minutes(-24 * 60), capturedAt: null, voidedAt: null, lastError: null, ...options.deposit,
  }];
  const refunds: RefundRow[] = (options.refunds ?? []).map((refund, index) => ({
    id: `old-refund-${index + 1}`, attemptId: 'attempt-1', idempotencyKey: `rfd_old${index + 1}`, squareRefundId: null, amountPence: 2000,
    status: 'COMPLETED', reason: 'STAFF_CANCELLED', requestedById: null, createdAt: minutes(-60), updatedAt: minutes(-60), ...refund,
  }));
  const deliveries: { eventKey: string; appointmentId: string; kind: string; payloadJson: string }[] = options.announced
    ? [{ eventKey: `appointment/${booking.id}/0/REQUEST_RECEIVED`, appointmentId: booking.id, kind: 'REQUEST_RECEIVED', payloadJson: '{}' }]
    : [];
  const audits: { actorUserId: string | null; action: string; metadata: Record<string, unknown> }[] = [];
  const counts = { refreshes: 0, slotChecks: 0, transactions: 0, dispatches: 0, invalidations: 0 };

  // --- Square --------------------------------------------------------------
  const squarePayments = new Map<string, SquareState>();
  const attempt = attempts[0];
  if (attempt?.squarePaymentId) {
    squarePayments.set(attempt.squarePaymentId, {
      id: attempt.squarePaymentId, amount: attempt.amountPence, referenceId: attempt.id, version: 1,
      status: options.squareStatus ?? (attempt.status === 'CAPTURED' ? 'COMPLETED' : 'APPROVED'),
      delayedUntil: (attempt.delayedUntil ?? minutes(5 * 24 * 60)).toISOString(),
    });
  }
  const squareCalls = { getPayment: [] as string[], capture: [] as CaptureInput[], cancel: [] as ReleaseInput[], refund: [] as RefundInput[], order: [] as string[] };
  const asPayment = (state: SquareState): SquarePayment => ({
    id: state.id, status: state.status, amount_money: { amount: state.amount, currency: 'GBP' }, location_id: 'fixture-location',
    source_type: 'CARD', reference_id: state.referenceId, version_token: `v${state.version}`, delay_action: 'CANCEL', delayed_until: state.delayedUntil,
  });
  const lookup = (paymentId: string) => {
    const state = squarePayments.get(paymentId);
    if (!state) throw new SquareGatewayError('provider_error', 404);
    return state;
  };
  const gateway = {
    getPayment: async (paymentId: string) => {
      squareCalls.getPayment.push(paymentId);
      squareCalls.order.push('getPayment');
      const real = () => asPayment(lookup(paymentId));
      return options.square?.getPayment ? options.square.getPayment(paymentId, real) : real();
    },
    capture: async (input: CaptureInput) => {
      squareCalls.capture.push(input);
      squareCalls.order.push('capture');
      const real = () => {
        const state = lookup(input.paymentId);
        if (state.status !== 'APPROVED' || input.versionToken !== `v${state.version}`) throw new SquareGatewayError('provider_error', 400);
        state.status = 'COMPLETED';
        state.version++;
        return asPayment(state);
      };
      return options.square?.capture ? options.square.capture(input, real) : real();
    },
    cancel: async (input: ReleaseInput) => {
      squareCalls.cancel.push(input);
      squareCalls.order.push('cancel');
      const real = () => {
        const state = lookup(input.paymentId);
        if (state.status !== 'APPROVED') throw new SquareGatewayError('provider_error', 400);
        state.status = 'CANCELED';
        state.version++;
        return asPayment(state);
      };
      return options.square?.cancel ? options.square.cancel(input, real) : real();
    },
    refund: async (input: RefundInput) => {
      squareCalls.refund.push(input);
      squareCalls.order.push('refund');
      const real = (): SquareRefund => ({
        id: `square-${input.idempotencyKey}`, payment_id: input.paymentId, location_id: 'fixture-location', status: 'PENDING',
        amount_money: { amount: input.amountPence, currency: 'GBP' },
      });
      return options.square?.refund ? options.square.refund(input, real) : real();
    },
  };

  // --- Database --------------------------------------------------------------
  type Undo = () => void;
  const sameValue = (value: unknown, expected: unknown) => (expected instanceof Date && value instanceof Date)
    ? value.getTime() === expected.getTime() : value === expected;
  const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const condition = expected as { in?: unknown[] };
      if (condition.in) return condition.in.includes(row[key]);
      return false;
    }
    return sameValue(row[key], expected);
  });
  const apply = (row: Record<string, unknown>, data: Record<string, unknown>, log: Undo[] | null) => {
    const before = { ...row };
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === 'object' && !(value instanceof Date) && 'increment' in value
        ? Number(row[key]) + Number((value as { increment: number }).increment) : value;
    }
    log?.push(() => { Object.assign(row, before); });
  };
  let refundSequence = 0;
  let transactionNumber = 0;
  function client(log: Undo[] | null) {
    return {
      appointment: {
        findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => {
          if (where.id !== booking.id) return null;
          if (select && Object.keys(select).length === 1 && select.stylistId) return { stylistId: booking.stylistId };
          return structuredClone(booking);
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (!matchesWhere(booking as unknown as Record<string, unknown>, where)) return { count: 0 };
          // @updatedAt
          apply(booking as unknown as Record<string, unknown>, { ...data, updatedAt: new Date(Date.now() + transactionNumber) }, log);
          return { count: 1 };
        },
      },
      paymentAttempt: {
        findUnique: async ({ where }: { where: { id?: string; appointmentId?: string } }) => {
          const row = attempts.find((candidate) => (where.id !== undefined ? candidate.id === where.id : candidate.appointmentId === where.appointmentId));
          return row ? structuredClone(row) : null;
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const matched = attempts.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where));
          for (const row of matched) apply(row as unknown as Record<string, unknown>, { updatedAt: new Date(), ...data }, log);
          return { count: matched.length };
        },
      },
      paymentRefund: {
        create: async ({ data }: { data: Omit<RefundRow, 'id' | 'squareRefundId' | 'createdAt' | 'updatedAt'> }) => {
          if (refunds.some((row) => row.idempotencyKey === data.idempotencyKey)) throw new Error('Unique constraint failed on idempotencyKey');
          const row: RefundRow = { id: `refund-${++refundSequence}`, squareRefundId: null, createdAt: new Date(), updatedAt: new Date(), ...data };
          refunds.push(row);
          log?.push(() => { refunds.splice(refunds.indexOf(row), 1); });
          return { id: row.id, amountPence: row.amountPence, idempotencyKey: row.idempotencyKey };
        },
        findUnique: async ({ where }: { where: { id: string } }) => {
          const row = refunds.find((candidate) => candidate.id === where.id);
          if (!row) return null;
          const owner = attempts.find((candidate) => candidate.id === row.attemptId)!;
          return { ...structuredClone(row), attempt: structuredClone(owner) };
        },
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          refunds.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where)).map((row) => structuredClone(row)),
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const matched = refunds.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where));
          // @updatedAt
          for (const row of matched) apply(row as unknown as Record<string, unknown>, { updatedAt: new Date(), ...data }, log);
          return { count: matched.length };
        },
      },
      notificationDelivery: {
        findFirst: async ({ where }: { where: { appointmentId: string; kind: string } }) =>
          deliveries.find((row) => row.appointmentId === where.appointmentId && row.kind === where.kind) ?? null,
        findUnique: async ({ where }: { where: { eventKey: string } }) => deliveries.find((row) => row.eventKey === where.eventKey) ?? null,
        upsert: async ({ create }: { create: { eventKey: string; appointmentId: string; kind: string; payloadJson: string } }) => {
          const existing = deliveries.find((row) => row.eventKey === create.eventKey);
          if (existing) return { id: existing.eventKey };
          deliveries.push(create);
          log?.push(() => { deliveries.splice(deliveries.indexOf(create), 1); });
          return { id: create.eventKey };
        },
      },
      siteSettings: { findUnique: async () => ({ phone: '07831 830898', salonNotificationLocale: 'zh-HK' }) },
      auditEvent: {
        create: async ({ data }: { data: { actorUserId: string | null; action: string; metadataJson: string } }) => {
          const row = { actorUserId: data.actorUserId, action: data.action, metadata: JSON.parse(data.metadataJson) };
          audits.push(row);
          log?.push(() => { audits.splice(audits.indexOf(row), 1); });
          return { id: 'audit' };
        },
      },
    };
  }
  const db = {
    ...client(null),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const number = ++transactionNumber;
      counts.transactions++;
      const log: Undo[] = [];
      try {
        const result = await fn(client(log));
        if (options.failTransaction === number) throw new Error('Synthetic database failure');
        return result;
      } catch (error) {
        for (const undo of log.reverse()) undo();
        throw error;
      }
    },
  };

  // --- Modules ------------------------------------------------------------------
  const outbox = loadServerModule<typeof import('../app/services/notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db, './email-service': {},
  });
  const queue = {
    enqueueAppointmentNotification: outbox.enqueueAppointmentNotification,
    dispatchAppointmentNotifications: async () => { counts.dispatches++; },
  };
  const bookingService = {
    runSerializableWithRetry: (fn: (tx: unknown) => Promise<unknown>) => db.$transaction(fn),
    assertAppointmentSlotAvailable: async () => {
      counts.slotChecks++;
      if (options.slotLostOnCheck === counts.slotChecks) throw new SlotUnavailableError();
    },
    getValidPatchTest: async () => ({ ok: true }),
  };
  const deposits = loadServerModule<typeof import('../app/services/deposit-lifecycle')>('src/app/services/deposit-lifecycle.ts', {
    '@/app/lib/online-booking-lock': { usableSquareConfig: () => (options.paymentsOff ? null : SANDBOX_CONFIG) },
    './square-gateway': { createSquareGateway: () => gateway },
  });
  const common = {
    '@/app/lib/prisma': db,
    '@/app/services/booking-service': bookingService,
    '@/app/services/notification-outbox-service': queue,
    '@/app/services/deposit-lifecycle': deposits,
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => { counts.invalidations++; } },
    '@/i18n/request': { getActionLocale: async () => options.locale ?? 'en-GB' },
    'next/cache': { revalidatePath: () => undefined, updateTag: () => undefined },
    'next/server': { after: (callback: () => unknown) => callback() },
  };
  const admin = loadServerModule<typeof import('../app/actions/admin')>('src/app/actions/admin.ts', {
    ...common,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: 'ADMIN' }) },
    '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async () => ({ ready: true, blockers: [] }) },
    '@/app/services/calendar-sync-service': {
      refreshCalendarFeedsBeforeApproval: async () => { counts.refreshes++; await options.onFeedRefresh?.(); return []; },
    },
    '@/app/actions/admin-services': { revalidateCategoryPages: async () => undefined },
  });
  const customer = loadServerModule<typeof import('../app/actions/booking')>('src/app/actions/booking.ts', {
    ...common,
    '@/app/lib/session': { verifySession: async () => ({ userId: options.customerId ?? booking.userId, role: 'USER' }) },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true, assertOnlineBookingReady: async () => ({ bookingEnabled: true, phone: '07831 830898' }) },
    '@/app/lib/rate-limit': {
      bookingLimiter: { check: async () => true }, availabilityLimiter: { check: async () => true },
      rescheduleLimiter: { check: async () => true }, appointmentRescheduleLimiter: { check: async () => true },
    },
    'next/headers': { headers: async () => new Headers() },
  });

  /** Every notice queued for the booking: its kind, the queued options and the deposit snapshot. */
  const queued = () => deliveries.filter((row) => row.payloadJson !== '{}').map((row) => {
    const payload = JSON.parse(row.payloadJson) as { options: Record<string, unknown>; appointment: Record<string, unknown> & { date: string; deposit: unknown } };
    const options = Object.fromEntries(Object.entries(payload.options).filter(([, value]) => value !== undefined && value !== null));
    return { kind: row.kind as AppointmentEmailKind, options, deposit: payload.appointment.deposit, payload };
  });
  /** A queued notice as the customer reads it, in `locale` — from its snapshot alone, as at send time. */
  const render = (kind: AppointmentEmailKind, locale: Locale): EmailContent => {
    const notice = queued().find((entry) => entry.kind === kind);
    if (!notice) throw new Error(`No ${kind} notice was queued`);
    const options = notice.payload.options as Record<string, unknown>;
    return appointmentEmailContent(kind, { ...notice.payload.appointment, date: new Date(notice.payload.appointment.date) } as unknown as EmailAppointment, locale, options as never);
  };

  return { booking, attempts, refunds, audits, counts, squareCalls, squarePayments, admin, customer, queued, render, BookingError };
}
