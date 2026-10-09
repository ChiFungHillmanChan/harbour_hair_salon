import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

test('My Bookings hands each card its reschedule request as a view model, never raw columns', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const card = () => null;
  const base = {
    date: new Date('2099-09-14T12:00:00Z'), status: 'CONFIRMED', stylistId: 'stylist-1', stylist: { name: 'Ivan' },
    serviceId: 'service-1', service: { name: 'Cut', duration: 30 }, review: null, priceAtBooking: 80, quoteJson: null, durationAtBooking: 60,
  };
  const appointments = [
    { ...base, id: 'none', rescheduleRequestedDate: null, rescheduleRequestedAt: null },
    { ...base, id: 'open', rescheduleRequestedDate: new Date('2099-09-15T09:00:00Z'), rescheduleRequestedAt: new Date('2099-09-01T11:00:00Z') },
    { ...base, id: 'expired', rescheduleRequestedDate: new Date('2099-09-02T09:00:00Z'), rescheduleRequestedAt: new Date('2099-08-30T10:00:00Z') },
  ];
  const page = loadServerModule<typeof import('../../app/[locale]/appointments/page')>('src/app/[locale]/appointments/page.tsx', {
    '@/components/admin/Pagination': { Pagination: () => null },
    '@/app/lib/prisma': { appointment: { findMany: async ({ where }: { where: { OR?: unknown } }) => where.OR ? [] : appointments } },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1' }) },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true },
    '@/components/appointments/AppointmentCard': { AppointmentCard: card },
    '@/i18n/ClientMessages': { ClientMessages: ({ children }: { children: unknown }) => children },
    '@/i18n/server': { getLocale: async () => 'en-GB', getT: async (namespace: Namespace) => translator('en-GB', namespace) },
  });
  const rendered = await page.default({});
  const cards: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as { type: unknown; props: { appointment?: Record<string, unknown>; children?: unknown } };
    if (element.type === card && element.props.appointment) cards.push(element.props.appointment);
    visit(element.props.children);
  };
  visit(rendered);
  assert.deepEqual(Object.fromEntries(cards.map((c) => [c.id, c.request])), {
    none: { state: 'none' },
    open: { state: 'open', requestedDate: '2099-09-15T09:00:00.000Z', requestedAt: '2099-09-01T11:00:00.000Z' },
    expired: { state: 'expired', requestedDate: '2099-09-02T09:00:00.000Z', requestedAt: '2099-08-30T10:00:00.000Z' },
  });
  assert.ok(cards.every((c) => !('rescheduleRequestedAt' in c) && !('rescheduleRequestedDate' in c)));
});
