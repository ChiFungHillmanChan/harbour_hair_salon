import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { bookingErrorText } from '../services/booking-errors';

// Security review 2026-10-16: staff attach a phone booking to the account that
// holds the customer's email, and anyone can register an address they do not
// own. So, as with booking online, seeing or changing a booking needs the
// address proved: an unconfirmed account cannot cancel, reschedule or withdraw
// a reschedule request — and nothing is written when it tries.

const APPOINTMENT = {
  id: 'appt-1', userId: 'user-1', status: 'CONFIRMED', date: new Date('2099-03-10T11:00:00Z'), stylistId: 'stylist-1', serviceId: 'service-1',
  durationAtBooking: 60, rescheduleRequestedDate: new Date('2099-03-12T11:00:00Z'), rescheduleRequestedAt: new Date('2099-03-01T09:00:00Z'),
  user: { email: 'victim@example.com', name: 'Victim' }, stylist: { name: 'Funky', treatwellExternalId: null }, service: { name: 'Cut', duration: 60, treatwellExternalId: null },
  treatwellBookingId: null,
};

function load(account: { emailVerifiedAt: Date | null; oauthAccounts: { provider: string }[] }) {
  const writes: string[] = [];
  const allow = { check: async () => true };
  const actions = loadServerModule<typeof import('./booking')>('src/app/actions/booking.ts', {
    '@/app/lib/prisma': {
      user: { findUnique: async () => account },
      appointment: {
        findUnique: async () => APPOINTMENT,
        updateMany: async () => { writes.push('appointment.updateMany'); return { count: 1 }; },
        update: async () => { writes.push('appointment.update'); return APPOINTMENT; },
      },
      $transaction: async () => { writes.push('transaction'); throw new Error('no write expected'); },
    },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: 'USER' }) },
    '@/app/lib/rate-limit': { cancelLimiter: allow, rescheduleLimiter: allow, appointmentRescheduleLimiter: allow },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => { writes.push('feed'); }, scheduleGoogleCalendarPush: () => { writes.push('google'); } },
    'next/server': { after: () => {} },
    'next/cache': { revalidatePath: () => {} },
    '@/i18n/request': { getActionLocale: async () => 'en-GB' },
  });
  return { actions, writes };
}

const refused = { success: false, code: 'MANAGE_EMAIL_NOT_VERIFIED', error: bookingErrorText('en-GB', 'MANAGE_EMAIL_NOT_VERIFIED') };

test('an account that never confirmed its email cannot cancel, reschedule or withdraw a request', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-03-01T12:00:00Z') });
  const { actions, writes } = load({ emailVerifiedAt: null, oauthAccounts: [] });
  assert.deepEqual(await actions.cancelAppointment('appt-1'), refused);
  assert.deepEqual(await actions.requestReschedule('appt-1', '2099-03-14', '11:00'), refused);
  assert.deepEqual(await actions.withdrawRescheduleRequest('appt-1'), refused);
  assert.deepEqual(writes, []);
});

test('a confirmed address, or a linked Google account, gets past the check', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-03-01T12:00:00Z') });
  // Past the check the action reaches the (unmocked) database and reports that.
  t.mock.method(console, 'error', () => {});
  for (const account of [
    { emailVerifiedAt: new Date('2026-01-01T00:00:00Z'), oauthAccounts: [] },
    { emailVerifiedAt: null, oauthAccounts: [{ provider: 'google' }] },
  ]) {
    const { actions } = load(account);
    const answer = await actions.withdrawRescheduleRequest('appt-1').catch((error: unknown) => ({ thrown: error }));
    assert.notDeepEqual(answer, refused);
  }
});
