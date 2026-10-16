import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import * as passwordModule from '../lib/password';
import { translator, type Namespace } from '../../i18n/messages';
import { localizeHref } from '../../i18n/paths';
import type { Locale } from '../../i18n/config';

// The language a customer uses the site in is the language of the mail the
// salon later sends on their behalf (a booking staff enter for them, say).
// Google sign-in is covered in api/auth/google/callback/route.test.ts and
// staff-entered bookings in admin-booking-entry.test.ts.

const allow = { check: async () => true };

function registerIn(locale: Locale) {
  const created: Record<string, unknown>[] = [];
  const { register } = loadServerModule<typeof import('./auth')>('src/app/actions/auth.ts', {
    '@/app/lib/prisma': { user: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { ...data, id: 'user-9', role: 'USER', sessionVersion: 0 }; },
    } },
    '@/app/lib/password': { ...passwordModule, hashPassword: async () => 'hash' },
    '@/app/lib/session': { createSession: async () => {} },
    '@/app/lib/audit': {},
    'next/headers': { headers: async () => new Headers() },
    'next/server': { after: () => {} },
    'next/navigation': { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    '@/app/lib/rate-limit': { registerLimiter: allow, emailSendDailyLimiter: allow },
    '@/app/services/email-service': { sendEmailVerification: async () => {} },
    '@/i18n/request': {
      getActionT: async (namespace: Namespace) => translator(locale, namespace),
      localizedPath: async (path: string) => localizeHref(locale, path),
    },
  });
  const form = new FormData();
  form.set('email', 'mei@example.invalid'); form.set('name', 'Mei'); form.set('password', 'a-good-password');
  return { submit: () => register(undefined, form), created };
}

for (const locale of ['zh-HK', 'en-GB'] as const) {
  test(`registering on the ${locale} site saves ${locale} as the customer's email language`, async () => {
    const f = registerIn(locale);
    await assert.rejects(f.submit(), /^Error: redirect:/);
    assert.equal(f.created[0].preferredLocale, locale);
  });
}

/** A signed-in, confirmed customer booking on a page in `pageLocale`. */
function bookAs(saved: string | null, pageLocale: Locale) {
  const writes: { where: unknown; data: unknown }[] = [];
  const bookings: Record<string, unknown>[] = [];
  const pending: Promise<unknown>[] = [];
  const actions = loadServerModule<typeof import('./booking')>('src/app/actions/booking.ts', {
    '@/app/lib/prisma': {
      user: {
        findUnique: async () => ({ emailVerifiedAt: new Date('2026-01-01'), oauthAccounts: [], preferredLocale: saved }),
        update: async ({ where, data }: { where: unknown; data: unknown }) => { writes.push({ where, data }); return {}; },
      },
      service: { findUnique: async () => ({
        id: 'service-1', price: '30.00', duration: 60, offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 1, vatDisplay: 'UNSPECIFIED',
        priceNature: 'LISTED', durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null, priceSource: null, depositOverridePence: null,
        requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false, isBookable: true, isPublic: true,
      }) },
      // No SiteSettings row: deposits off (services/deposit-quote.ts), so no card deposit is due.
      siteSettings: { findUnique: async () => null },
      availability: { findFirst: async () => ({ startTime: '09:00', endTime: '18:00' }) },
    },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: 'USER' }) },
    '@/app/lib/rate-limit': { bookingLimiter: allow, bookingDailyLimiter: allow },
    '@/app/services/booking-service': { createBooking: async (input: Record<string, unknown>) => { bookings.push(input); return { id: 'appt-1' }; } },
    '@/app/services/notification-outbox-service': { dispatchAppointmentNotifications: async () => {} },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => {} },
    'next/server': { after: (callback: () => Promise<unknown>) => { pending.push(Promise.resolve().then(callback)); } },
    'next/cache': { revalidatePath: () => {} },
    '@/i18n/request': { getActionLocale: async () => pageLocale },
  });
  const submit = async () => {
    const result = await actions.submitBooking({ stylistId: 'stylist-1', serviceId: 'service-1', date: '2099-01-05', time: '10:00' });
    await Promise.all(pending);
    return result;
  };
  return { submit, writes, bookings };
}

test('a booking made in another language than the saved one updates the customer\'s email language', async () => {
  const f = bookAs('en-GB', 'zh-HK');
  assert.deepEqual(await f.submit(), { success: true });
  assert.equal(f.bookings[0].locale, 'zh-HK', 'the booking itself records its language');
  assert.deepEqual(f.writes, [{ where: { id: 'user-1' }, data: { preferredLocale: 'zh-HK' } }]);
});

test('an account with no saved language gets the booking\'s', async () => {
  const f = bookAs(null, 'en-GB');
  assert.deepEqual(await f.submit(), { success: true });
  assert.deepEqual(f.writes, [{ where: { id: 'user-1' }, data: { preferredLocale: 'en-GB' } }]);
});

test('a booking in the language already saved writes nothing extra', async () => {
  const f = bookAs('zh-HK', 'zh-HK');
  assert.deepEqual(await f.submit(), { success: true });
  assert.deepEqual(f.writes, []);
});
