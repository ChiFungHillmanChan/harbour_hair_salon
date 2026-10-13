import { loadServerModule } from './load-server-module';
import type { Locale } from '../i18n/config';

/** Two stylists who work every day, 10:00–19:00 salon time, in name order. */
export const FIXTURE_STYLISTS = ['funky', 'lox'];
export const FIXTURE_HOURS = { startTime: '10:00', endTime: '19:00' };

type Row = { id: string; userId: string; serviceId: string; stylistId: string; date: Date; status: string; durationAtBooking: number; notificationVersion: number };
type Where = { userId?: string; serviceId?: string; date?: Date | { gte?: Date; lte?: Date }; stylistId?: string | { in: string[] }; status?: { in?: string[]; not?: string } };

/**
 * The real booking service and actions over a small stateful fake database:
 * created appointments are stored and then seen by every later read (slot
 * grids, conflict checks, the repeat-request lookup, the booking cap).
 * Records the notices enqueued and the post-commit side effects.
 */
export function bookingFixture(options: { locale?: Locale } = {}) {
  const rows: Row[] = [];
  const notices: string[] = [];
  const effects = { feedInvalidations: 0, dispatches: 0 };
  const liveService = {
    id: 'service-1', name: 'Cut', price: '100.00', duration: 60, treatwellExternalId: null, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false,
    offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 1, vatDisplay: 'EXCLUDED', priceNature: 'LISTED',
    durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null, priceSource: 'test', isPublic: true, isBookable: true,
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
  const tx = {
    service: { findUnique: async () => liveService },
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
    externalBusyBlock: { findMany: async () => [] },
    user: { findUnique: async () => ({ emailVerifiedAt: new Date(), oauthAccounts: [] }), update: async () => ({}) },
  };
  const db = { ...tx, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
  const queue = {
    enqueueAppointmentNotification: async (_db: unknown, kind: string, appointment: { id: string }) => {
      notices.push(`${appointment.id}/${kind}`);
      return { id: `event-${notices.length}` };
    },
    dispatchAppointmentNotifications: async () => { effects.dispatches++; },
  };
  const readiness = {
    isBookingEnabled: async () => true,
    assertOnlineBookingReady: async () => ({ bookingEnabled: true, phone: '0113 000 0000' }),
  };
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
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: 'USER' }) },
    '@/app/lib/rate-limit': { bookingLimiter: { check: async () => true }, availabilityLimiter: { check: async () => true } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => { effects.feedInvalidations++; } },
    '@/i18n/request': { getActionLocale: async () => options.locale ?? 'en-GB' },
    'next/headers': { headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }) },
    'next/server': { after: (callback: () => unknown) => callback() },
    'next/cache': { revalidatePath: () => undefined },
  });
  return { service, actions, rows, notices, effects };
}
