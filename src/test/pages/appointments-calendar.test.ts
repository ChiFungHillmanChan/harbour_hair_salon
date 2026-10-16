import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

type Card = { id: string; calendar: Record<string, unknown> | null };

async function cards(locale: Locale, rows: { upcoming: Record<string, unknown>[]; past?: Record<string, unknown>[] }) {
  const card = () => null;
  const queries: string[] = [];
  const page = loadServerModule<typeof import('../../app/[locale]/appointments/page')>('src/app/[locale]/appointments/page.tsx', {
    '@/components/admin/Pagination': { Pagination: () => null },
    '@/app/lib/prisma': {
      user: { findUnique: async () => ({ email: 'customer@example.com', emailVerifiedAt: new Date('2026-01-01T00:00:00Z'), oauthAccounts: [] }) }, 
      appointment: { findMany: async ({ where }: { where: { OR?: unknown } }) => { queries.push('appointment'); return where.OR ? rows.past ?? [] : rows.upcoming; } },
      contentTranslation: { findMany: async () => { queries.push('contentTranslation'); return [{ entityId: 'service-1', fieldsJson: JSON.stringify({ name: '洗剪吹' }) }]; } },
    },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1' }) },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true },
    '@/components/appointments/AppointmentCard': { AppointmentCard: card },
    '@/components/auth/VerifyEmailResendForm': { VerifyEmailResendForm: () => null },
    '@/i18n/ClientMessages': { ClientMessages: ({ children }: { children: unknown }) => children },
    '@/i18n/server': { getLocale: async () => locale, getT: async (namespace: Namespace) => translator(locale, namespace) },
  });
  const rendered = await page.default({});
  const found: Card[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as { type: unknown; props: { appointment?: Card; children?: unknown } };
    if (element.type === card && element.props.appointment) found.push(element.props.appointment);
    visit(element.props.children);
  };
  visit(rendered);
  return { cards: found, queries };
}

const row = (id: string, status: string, date: string) => ({
  id, status, date: new Date(date), stylistId: 'stylist-1', stylist: { name: 'Ivan' }, serviceId: 'service-1',
  service: { name: 'Cut & Blow-dry', duration: 30 }, review: null, priceAtBooking: 45, quoteJson: null, durationAtBooking: 85,
  rescheduleRequestedDate: null, rescheduleRequestedAt: null, notificationVersion: 2,
});

test('a confirmed upcoming booking carries its calendar entry; a pending request and a past visit do not', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const { cards: shown, queries } = await cards('en-GB', {
    upcoming: [row('confirmed', 'CONFIRMED', '2099-09-14T12:00:00Z'), row('pending', 'PENDING', '2099-09-15T12:00:00Z')],
    past: [row('past', 'CONFIRMED', '2099-08-01T12:00:00Z')],
  });
  const byId = Object.fromEntries(shown.map((c) => [c.id, c.calendar]));
  assert.deepEqual(byId.confirmed, {
    uid: 'appointment-confirmed@harbourhair.co.uk',
    sequence: 2,
    start: '2099-09-14T12:00:00.000Z',
    end: '2099-09-14T13:25:00.000Z',
    title: 'Cut & Blow-dry at Harbour Hair Salon',
    details: 'Stylist: Ivan\nView or change your booking: https://www.harbourhair.co.uk/appointments',
    location: 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX',
    url: 'https://www.harbourhair.co.uk/appointments',
    filename: 'harbour-hair-2099-09-14.ics',
  });
  assert.equal(byId.pending, null);
  assert.equal(byId.past, null);
  assert.deepEqual(queries, ['appointment', 'appointment'], 'no extra query: built from the rows already read');
});

test('on /zh-hk the entry uses the published Chinese service name and the Chinese My Bookings', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const { cards: shown } = await cards('zh-HK', { upcoming: [row('confirmed', 'CONFIRMED', '2099-09-14T12:00:00Z')] });
  const calendar = shown[0].calendar!;
  assert.equal(calendar.title, '洗剪吹｜Harbour Hair Salon');
  assert.equal(calendar.url, 'https://www.harbourhair.co.uk/zh-hk/appointments');
  assert.equal(calendar.details, '髮型師：Ivan\n查看或更改預約：https://www.harbourhair.co.uk/zh-hk/appointments');
});
