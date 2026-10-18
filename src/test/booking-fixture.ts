import { Prisma } from '@prisma/client';
import { loadServerModule } from './load-server-module';
import { createFailureLimiter, createRateLimiter, DEPOSIT_AUTHORIZE_IP_POLICY, DEPOSIT_DECLINE_ACCOUNT_POLICY, DEPOSIT_DECLINE_IP_POLICY } from '../app/lib/rate-limit';
import { BookingError } from '../app/services/booking-errors';
import type { SquarePayment } from '../app/services/square-gateway';
import type { DepositSettings } from '../app/services/deposit-quote';
import type { Locale } from '../i18n/config';

/** Two stylists who work every day, 10:00–19:00 salon time, in name order. */
export const FIXTURE_STYLISTS = ['funky', 'lox'];
export const FIXTURE_HOURS = { startTime: '10:00', endTime: '19:00' };

/** A complete, parseable Square SANDBOX configuration (lib/square-config.ts). */
export const SANDBOX_SQUARE_ENV = {
  SQUARE_PAYMENTS_ENABLED: 'true',
  SQUARE_ENVIRONMENT: 'sandbox',
  SQUARE_ACCESS_TOKEN: 'sandbox-access-token',
  SQUARE_APPLICATION_ID: 'sandbox-sq0idb-fixture',
  SQUARE_LOCATION_ID: 'fixture-location',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'sandbox-signature-key',
  SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://example.test/api/webhooks/square',
};

type Row = { id: string; userId: string; serviceId: string; stylistId: string; date: Date; status: string; durationAtBooking: number; notificationVersion: number };
type Where = { userId?: string; serviceId?: string; date?: Date | { gte?: Date; lte?: Date }; stylistId?: string | { in: string[] }; status?: { in?: string[]; not?: string } };

/** A PaymentAttempt row as the fake database keeps it. */
export type AttemptRow = {
  id: string; userId: string | null; attemptKey: string; idempotencyKey: string; appointmentId: string | null; status: string;
  environment: string; locationId: string; amountPence: number; currency: string; quoteAmountPence: number;
  policyJson: string; requestJson: string; squarePaymentId: string | null; delayedUntil: Date | null;
  authorizedAt: Date | null; capturedAt: Date | null; voidedAt: Date | null; lastError: string | null;
};

type AuthorizeInput = { sourceId: string; amountPence: number; idempotencyKey: string; referenceId: string; note?: string };
type CancelInput = { paymentId: string; amountPence: number; referenceId: string };

/** How the fake Square answers. Defaults: authorizations approved, cancellations succeed. */
export type FakeSquare = {
  authorize?: (input: AuthorizeInput) => Promise<SquarePayment>;
  cancel?: (input: CancelInput) => Promise<SquarePayment>;
  cancelByIdempotencyKey?: (key: string) => Promise<void>;
};

/** An approved delayed-capture payment, as Square answers CreatePayment. */
export function approvedPayment(input: AuthorizeInput): SquarePayment {
  return {
    id: `payment-for-${input.referenceId}`, status: 'APPROVED', amount_money: { amount: input.amountPence, currency: 'GBP' },
    location_id: SANDBOX_SQUARE_ENV.SQUARE_LOCATION_ID, source_type: 'CARD', reference_id: input.referenceId,
    delay_action: 'CANCEL', delayed_until: '2026-10-08T09:00:00Z', version_token: 'version-1',
  };
}

function uniqueViolation(target: string) {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (${target})`, { code: 'P2002', clientVersion: 'fixture', meta: { target } });
}

/**
 * The real booking service and actions over a small stateful fake database:
 * created appointments are stored and then seen by every later read (slot
 * grids, conflict checks, the repeat-request lookup, the booking cap), as are
 * card-deposit attempts. Records the notices enqueued, the post-commit side
 * effects and every call to the fake Square gateway.
 *
 * `enabled: false` closes booking at the cached page gate (isBookingEnabled);
 * `ready: false` closes it only at the authoritative check inside the booking
 * transaction, as when it closes between loading the times and confirming.
 * `betaTesters`: the customer ids on the beta list (lib/booking-maintenance.ts),
 * who still book while `enabled: false`; `gateUserIds` records which account
 * each beta-aware check was asked about.
 * `deposits` is the SiteSettings deposit policy (default: off, as a row never
 * saved); `squareEnv` the environment the Square configuration is read from
 * (default: a sandbox configuration in a non-production run).
 */
export function bookingFixture(options: {
  locale?: Locale;
  enabled?: boolean;
  ready?: boolean;
  deposits?: DepositSettings;
  squareEnv?: Record<string, string | undefined>;
  square?: FakeSquare;
  /** Runs as each booking transaction starts — e.g. another customer takes the time first. */
  onTransaction?: (rows: Row[]) => void;
  /** The first booking transaction commits, then its answer is lost (a dropped connection): a non-BookingError. */
  commitAnswerLost?: boolean;
  /** Runs on every read of a payment attempt by its id (throw to make the database fail there). */
  onAttemptReadById?: () => void;
  /** The client address the requests come from (x-forwarded-for). */
  clientIp?: string;
  /** Customer ids on the beta list: they book while `enabled: false` (not past `ready: false`). */
  betaTesters?: string[];
} = {}) {
  /** The signed-in customer and their address; `asCustomer` switches them (every account is verified). */
  let customerId = 'user-1';
  let clientIp = options.clientIp ?? '203.0.113.7';
  // The real decline limiters, in memory (no Redis): they persist across this fixture's requests.
  const declineLimiters = {
    depositDeclineAccountLimiter: createFailureLimiter(DEPOSIT_DECLINE_ACCOUNT_POLICY, { redis: null }),
    depositDeclineIpLimiter: createFailureLimiter(DEPOSIT_DECLINE_IP_POLICY, { redis: null }),
  };
  // The real authorization budget too, spent before Square is asked.
  const authorizeLimiters = {
    depositAuthorizeIpLimiter: createRateLimiter(DEPOSIT_AUTHORIZE_IP_POLICY, { redisLimiter: null }),
  };
  const rows: Row[] = [];
  const attempts: AttemptRow[] = [];
  const notices: string[] = [];
  /** The deposit each queued notice was given (services/notification-outbox-service.ts). */
  const queuedDeposits: { kind: string; appointmentId: string; paymentAttempt: unknown }[] = [];
  const effects = { feedInvalidations: 0, dispatches: 0, dispatchedFor: [] as string[] };
  const squareCalls: { authorize: AuthorizeInput[]; cancel: CancelInput[]; cancelByIdempotencyKey: string[]; configs: (() => Promise<unknown>)[] } = {
    authorize: [], cancel: [], cancelByIdempotencyKey: [], configs: [],
  };
  const liveService = {
    id: 'service-1', name: 'Cut', price: '100.00', duration: 60, treatwellExternalId: null, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false,
    offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 1, vatDisplay: 'EXCLUDED', priceNature: 'LISTED',
    durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null, priceSource: 'test', isPublic: true, isBookable: true,
    depositOverridePence: null as number | null,
  };
  const withRelations = (row: Row) => ({
    ...row,
    user: { name: 'Customer', email: 'customer@example.test', phone: null },
    stylist: { name: row.stylistId },
    service: { name: liveService.name, price: liveService.price, duration: liveService.duration },
  });
  const stylistMatches = (filter: Where['stylistId'], id: string) => filter === undefined || (typeof filter === 'string' ? filter === id : filter.in.includes(id));
  const statusMatches = (filter: Where['status'], status: string) => !filter || (filter.in ? filter.in.includes(status) : status !== filter.not);
  const dateMatches = (filter: Where['date'], date: Date) => {
    if (filter === undefined) return true;
    if (filter instanceof Date) return filter.getTime() === date.getTime();
    return (!filter.gte || date >= filter.gte) && (!filter.lte || date <= filter.lte);
  };
  type AttemptWhere = Partial<Pick<AttemptRow, 'id' | 'userId' | 'status' | 'appointmentId'>>;
  const attemptMatches = (row: AttemptRow, where: AttemptWhere) => Object.entries(where).every(([key, value]) => row[key as keyof AttemptRow] === value);
  const tx = {
    service: { findUnique: async () => liveService },
    siteSettings: { findUnique: async () => options.deposits ?? null },
    stylist: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id, isActive: true, treatwellExternalId: null }),
      // eligibleStylistIds: everyone works every day.
      findMany: async () => FIXTURE_STYLISTS.map((id) => ({ id, availabilities: [FIXTURE_HOURS] })),
    },
    availability: {
      findFirst: async () => FIXTURE_HOURS,
      findMany: async ({ where }: { where: { stylistId?: string; dayOfWeek?: number } }) => FIXTURE_STYLISTS
        .filter((stylistId) => !where.stylistId || where.stylistId === stylistId)
        .flatMap((stylistId) => [0, 1, 2, 3, 4, 5, 6]
          .filter((dayOfWeek) => where.dayOfWeek === undefined || where.dayOfWeek === dayOfWeek)
          .map((dayOfWeek) => ({ stylistId, dayOfWeek, ...FIXTURE_HOURS }))),
    },
    appointment: {
      count: async ({ where }: { where: Where }) => rows.filter((row) => row.userId === where.userId && statusMatches(where.status, row.status)).length,
      findFirst: async ({ where }: { where: Where }) => {
        const row = rows.find((candidate) => candidate.userId === where.userId && candidate.serviceId === where.serviceId
          && dateMatches(where.date, candidate.date) && stylistMatches(where.stylistId, candidate.stylistId)
          && statusMatches(where.status, candidate.status));
        return row ? withRelations(row) : null;
      },
      findMany: async ({ where }: { where: Where }) => rows
        .filter((row) => stylistMatches(where.stylistId, row.stylistId) && statusMatches(where.status, row.status) && dateMatches(where.date, row.date))
        .map((row) => ({ ...row, service: { duration: row.durationAtBooking } })),
      create: async ({ data }: { data: Omit<Row, 'id' | 'notificationVersion'> }) => {
        const row: Row = { id: `appointment-${rows.length + 1}`, notificationVersion: 0, ...data };
        rows.push(row);
        return withRelations(row);
      },
    },
    paymentAttempt: {
      create: async ({ data }: { data: Partial<AttemptRow> & Pick<AttemptRow, 'attemptKey' | 'idempotencyKey'> }) => {
        if (attempts.some((row) => row.userId === data.userId && row.attemptKey === data.attemptKey)) throw uniqueViolation('userId,attemptKey');
        if (attempts.some((row) => row.idempotencyKey === data.idempotencyKey)) throw uniqueViolation('idempotencyKey');
        const row: AttemptRow = {
          id: `attempt${attempts.length + 1}`, userId: null, appointmentId: null, status: 'INITIATED', environment: '', locationId: '',
          amountPence: 0, currency: 'GBP', quoteAmountPence: 0, policyJson: '{}', requestJson: '{}', squarePaymentId: null,
          delayedUntil: null, authorizedAt: null, capturedAt: null, voidedAt: null, lastError: null, ...data,
        };
        attempts.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: { where: { id?: string; userId_attemptKey?: { userId: string; attemptKey: string } } }) => {
        if (where.id) options.onAttemptReadById?.();
        const row = attempts.find((candidate) => where.id
          ? candidate.id === where.id
          : candidate.userId === where.userId_attemptKey?.userId && candidate.attemptKey === where.userId_attemptKey?.attemptKey);
        return row ? { ...row } : null;
      },
      updateMany: async ({ where, data }: { where: AttemptWhere; data: Partial<AttemptRow> }) => {
        const matched = attempts.filter((row) => attemptMatches(row, where));
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
      },
    },
    googleDiaryEntry: { findMany: async () => [] },
    externalBusyBlock: { findMany: async () => [] },
    user: { findUnique: async () => ({ emailVerifiedAt: new Date(), oauthAccounts: [] }), update: async () => ({}) },
  };
  let commitAnswerLost = options.commitAnswerLost === true;
  const db = {
    ...tx,
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
      options.onTransaction?.(rows);
      const result = await fn(tx);
      if (commitAnswerLost) {
        // Committed (the fake keeps every write), but the answer never arrives.
        commitAnswerLost = false;
        throw new Error('Connection lost while committing');
      }
      return result;
    },
  };
  const queue = {
    enqueueAppointmentNotification: async (_db: unknown, kind: string, appointment: { id: string; paymentAttempt?: unknown }) => {
      notices.push(`${appointment.id}/${kind}`);
      queuedDeposits.push({ kind, appointmentId: appointment.id, paymentAttempt: appointment.paymentAttempt ?? null });
      return { id: `event-${notices.length}` };
    },
    dispatchAppointmentNotifications: async (appointmentId: string) => { effects.dispatches++; effects.dispatchedFor.push(appointmentId); },
  };
  const betaTesters = new Set(options.betaTesters ?? []);
  const gateUserIds: (string | null | undefined)[] = [];
  const isBetaTester = (userId: string | null | undefined) => Boolean(userId && betaTesters.has(userId));
  const readiness = {
    isBookingEnabled: async () => options.enabled !== false,
    assertOnlineBookingReady: async () => {
      if (options.enabled === false || options.ready === false) throw new BookingError('MAINTENANCE');
      return { bookingEnabled: true, phone: '0113 000 0000' };
    },
    isBetaBookingOpenFor: async (userId: string | null | undefined) => {
      gateUserIds.push(userId);
      return options.ready !== false && isBetaTester(userId);
    },
    assertOnlineBookingReadyFor: async (_db: unknown, userId: string | null | undefined) => {
      gateUserIds.push(userId);
      if (options.ready === false || (options.enabled === false && !isBetaTester(userId))) throw new BookingError('MAINTENANCE');
      return { bookingEnabled: options.enabled !== false, phone: '0113 000 0000' };
    },
  };
  const square = options.square ?? {};
  const gateway = {
    authorize: async (input: AuthorizeInput) => {
      squareCalls.authorize.push(input);
      return (square.authorize ?? (async (request: AuthorizeInput) => approvedPayment(request)))(input);
    },
    cancel: async (input: CancelInput) => {
      squareCalls.cancel.push(input);
      if (square.cancel) return square.cancel(input);
      return { ...approvedPayment({ sourceId: 'unused', amountPence: input.amountPence, idempotencyKey: 'unused', referenceId: input.referenceId }), id: input.paymentId, status: 'CANCELED' as const };
    },
    cancelByIdempotencyKey: async (key: string) => {
      squareCalls.cancelByIdempotencyKey.push(key);
      await square.cancelByIdempotencyKey?.(key);
    },
  };
  // The real configuration rule (production builds need production
  // credentials), over the environment the test chose instead of process.env.
  const realLock = loadServerModule<typeof import('../app/lib/online-booking-lock')>('src/app/lib/online-booking-lock.ts', {});
  const squareEnv = options.squareEnv ?? SANDBOX_SQUARE_ENV;
  const service = loadServerModule<typeof import('../app/services/booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': readiness,
    './notification-outbox-service': queue,
  });
  const actions = loadServerModule<typeof import('../app/actions/booking')>('src/app/actions/booking.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/booking-service': service,
    '@/app/lib/booking-maintenance': readiness,
    '@/app/services/notification-outbox-service': queue,
    // The session cookie names the same customer verifySession proves.
    '@/app/lib/session': { verifySession: async () => ({ userId: customerId, role: 'USER' }), getSession: async () => ({ userId: customerId }) },
    '@/app/lib/rate-limit': { bookingLimiter: { check: async () => true }, bookingDailyLimiter: { check: async () => true }, cancelLimiter: { check: async () => true }, availabilityLimiter: { check: async () => true }, ...declineLimiters, ...authorizeLimiters },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => { effects.feedInvalidations++; }, scheduleGoogleCalendarPush: () => undefined },
    '@/app/lib/online-booking-lock': { usableSquareConfig: () => realLock.usableSquareConfig(squareEnv) },
    // The gateway the action builds is the fake; the configuration it was
    // given is kept so a test can check which one money would move with.
    '@/app/services/square-gateway': {
      createSquareGateway: (dependencies: { loadConfig: () => Promise<unknown> }) => {
        squareCalls.configs.push(dependencies.loadConfig);
        return gateway;
      },
    },
    '@/i18n/request': { getActionLocale: async () => options.locale ?? 'en-GB' },
    'next/headers': { headers: async () => new Headers({ 'x-forwarded-for': clientIp }) },
    'next/server': { after: (callback: () => unknown) => callback() },
    'next/cache': { revalidatePath: () => undefined },
  });
  return { service, actions, rows, attempts, notices, queuedDeposits, effects, squareCalls, liveService, gateway, gateUserIds, asCustomer: (id: string, ip?: string) => { customerId = id; if (ip) clientIp = ip; } };
}
