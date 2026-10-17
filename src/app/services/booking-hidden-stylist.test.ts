import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadServerModule } from '../../test/load-server-module';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { resolveSalonDateTime } from './salon-time';

// A stylist switched off "Show on website" (Stylist.showOnWebsite false) is
// never offered to a customer making a NEW booking — not by name, not through
// "Anyone" — but their own existing bookings can still be moved (reschedule
// uses the same named-stylist lookups), and staff paths are untouched.
before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const DAY = '2026-10-06'; // a Tuesday
const at = (time: string) => resolveSalonDateTime(DAY, time).utc;
type Where = { stylistId?: string; stylist?: { isActive?: boolean; showOnWebsite?: boolean } };

function fixture(input: { shaniaShown?: boolean } = {}) {
  const shown: Record<string, boolean> = { lox: true, shania: input.shaniaShown ?? false };
  // Lox works the morning only; Shania all day.
  const hours = [
    { stylistId: 'lox', dayOfWeek: 2, startTime: '10:00', endTime: '13:00' },
    { stylistId: 'shania', dayOfWeek: 2, startTime: '10:00', endTime: '19:00' },
  ];
  const matches = (row: { stylistId: string }, where: Where) =>
    (!where.stylistId || row.stylistId === where.stylistId)
    && (where.stylist?.showOnWebsite === undefined || shown[row.stylistId] === where.stylist.showOnWebsite);
  const db = {
    availability: {
      findMany: async ({ where }: { where: Where }) => hours.filter((row) => matches(row, where)),
      findFirst: async ({ where }: { where: Where & { dayOfWeek: number } }) => hours.find((row) => matches(row, where) && row.dayOfWeek === where.dayOfWeek) ?? null,
    },
    appointment: { findMany: async () => [], count: async () => 0 },
    externalBusyBlock: { findMany: async () => [] },
    googleDiaryEntry: { findMany: async () => [] },
    stylist: { findUnique: async ({ where }: { where: { id: string } }) => ({ isActive: true, showOnWebsite: shown[where.id], treatwellExternalId: null }) },
  };
  return loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({}) },
    './notification-outbox-service': {},
    './pricing/quote-service': { quoteForNewBooking: async () => ({ service: { id: 'svc', duration: 60, treatwellExternalId: null }, quote: { amountPence: 3000 } }) },
  });
}
const open = (days: { slots: { time: string; available: boolean }[] }[], time: string) => days[0]?.slots.find((s) => s.time === time)?.available === true;

test('"Anyone" never offers a hidden stylist: the afternoon (Shania only) is closed until she is shown', async () => {
  const hidden = fixture();
  assert.equal(open(await hidden.getBookingDays(ANY_STYLIST_ID, [DAY], 60), '11:00'), true, 'Lox, shown, still serves the morning');
  assert.equal(open(await hidden.getBookingDays(ANY_STYLIST_ID, [DAY], 60), '15:00'), false);
  assert.ok(!(await hidden.getAvailableSlotsUnion(DAY, 60)).some((s) => s.time === '15:00' && s.available));
  const shown = fixture({ shaniaShown: true });
  assert.equal(open(await shown.getBookingDays(ANY_STYLIST_ID, [DAY], 60), '15:00'), true);
  assert.ok((await shown.getAvailableSlotsUnion(DAY, 60)).some((s) => s.time === '15:00' && s.available));
});

test('a new booking naming a hidden stylist is refused before any slot check; a shown one is not', async () => {
  const request = { userId: 'u1', serviceId: 'svc', date: at('15:00'), stylistId: 'shania' };
  await assert.rejects(fixture().precheckBookingRequest(request), (error: { code?: string }) => error.code === 'STYLIST_UNAVAILABLE');
  await fixture({ shaniaShown: true }).precheckBookingRequest(request);
});

test('a hidden stylist’s own times can still be read by name (rescheduling an existing booking)', async () => {
  assert.equal(open(await fixture().getBookingDays('shania', [DAY], 60), '15:00'), true);
});

test('every new-booking path refuses a hidden stylist through the one check', () => {
  const source = readFileSync('src/app/services/booking-service.ts', 'utf8');
  for (const name of ['createBooking', 'createBookingForFirstAvailable', 'precheckBookingRequest']) {
    const start = source.search(new RegExp(`^export async function ${name}\\(`, 'm'));
    const body = source.slice(start, source.indexOf('\n}\n', start));
    assert.match(body, /assertShownOnWebsite\(/, name);
  }
  // The "Anyone" candidates the booking action hands over come from shown stylists only.
  assert.match(readFileSync('src/app/actions/booking.ts', 'utf8'), /async function eligibleStylistIds[\s\S]*?where: \{ isActive: true, showOnWebsite: true,/);
});
