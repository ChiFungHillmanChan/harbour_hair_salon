import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

test('My Bookings sends the frozen price and duration to cards and their reschedule modal', async () => {
  const card = () => null;
  const appointments = [
    { id: 'frozen', priceAtBooking: 80, durationAtBooking: 60 },
    { id: 'free', priceAtBooking: 0, durationAtBooking: 45 },
    { id: 'legacy', priceAtBooking: null, durationAtBooking: null },
  ].map((snapshot) => ({
    ...snapshot, date: new Date('2099-09-15T10:00:00Z'), status: 'CONFIRMED',
    stylistId: 'stylist-1', stylist: { name: 'Stylist' }, serviceId: 'service-1',
    service: { name: 'Cut', price: 120, duration: 30 }, review: null,
    treatwellBookingId: 'provider-private-reference', treatwellSyncError: 'internal diagnostic',
  }));
  const page = loadServerModule<typeof import('./page')>('src/app/appointments/page.tsx', {
    '@/components/admin/Pagination': { Pagination: () => null },
    '@/app/lib/prisma': { appointment: { findMany: async ({ where }: { where: { OR?: unknown } }) => where.OR ? [] : appointments } },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1' }) },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true },
    '@/components/appointments/AppointmentCard': { AppointmentCard: card },
  });
  const rendered = await page.default({});
  const cards: { id: string; service: { price: number; duration: number } }[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as { type: unknown; props: { appointment?: (typeof cards)[number]; children?: unknown } };
    if (element.type === card && element.props.appointment) cards.push(element.props.appointment);
    visit(element.props.children);
  };
  visit(rendered);
  assert.deepEqual(cards.map(({ id, service }) => [id, service.price, service.duration]), [
    ['frozen', 80, 60], ['free', 0, 45], ['legacy', 120, 30],
  ]);
  assert.ok(cards.every((appointment) => !('treatwellSyncError' in appointment) && !('treatwellBookingId' in appointment)));
});
