import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { bookingFixture as fixture } from '../../test/booking-fixture';
import { resolveSalonDateTime } from './salon-time';

/**
 * A customer may hold at most six UPCOMING requests or bookings
 * (assertActiveBookingLimit in booking-service.ts). Past visits never count:
 * staff mark a visit COMPLETED by hand, so a regular's old visits often stay
 * CONFIRMED, and counting them would refuse every new booking they make.
 */

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const at = (day: string, time = '11:00') => resolveSalonDateTime(day, time).utc;

function seed(f: ReturnType<typeof fixture>, days: string[], status = 'CONFIRMED') {
  days.forEach((day, index) => f.rows.push({
    id: `seeded-${day}-${index}`, userId: 'user-1', serviceId: 'service-1', stylistId: 'lox',
    date: at(day), status, durationAtBooking: 60, notificationVersion: 0,
  }));
}

test('six past visits still marked confirmed do not stop a regular booking again', async () => {
  const f = fixture();
  seed(f, ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-24', '2026-09-29']);

  const booked = await f.service.createBooking({ serviceId: 'service-1', date: at('2026-10-06'), userId: 'user-1', stylistId: 'funky' });
  assert.equal(booked.repeat, false);
  assert.equal(f.rows.length, 7);
});

test('a seventh upcoming booking is refused', async () => {
  const f = fixture();
  seed(f, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);

  await assert.rejects(
    f.service.createBooking({ serviceId: 'service-1', date: at('2026-10-13'), userId: 'user-1', stylistId: 'funky' }),
    (error: { code?: string }) => error.code === 'MAX_UPCOMING',
  );
  assert.equal(f.rows.length, 6, 'nothing was booked');
});

test('a cancelled upcoming booking frees its place under the cap', async () => {
  const f = fixture();
  seed(f, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  seed(f, ['2026-10-10'], 'CANCELLED');

  const booked = await f.service.createBooking({ serviceId: 'service-1', date: at('2026-10-13'), userId: 'user-1', stylistId: 'funky' });
  assert.equal(booked.repeat, false);
});
