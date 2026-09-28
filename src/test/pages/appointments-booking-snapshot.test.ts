import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

test('My Bookings sends the recorded price and duration to cards and their reschedule modal', async () => {
  const card = () => null;
  const nhsQuote = JSON.stringify({
    schema: 1, serviceId: 'service-1', offeringId: 'offering-1', hairLength: 'LONG', priceType: 'NHS', currency: 'GBP',
    amountPence: 4499, breakdown: [{ kind: 'LISTED', amountPence: 4499 }], vatDisplay: 'EXCLUDED', priceNature: 'LISTED',
    priceVersion: 2, durationMinutes: 90, durationSource: 'SERVICE', discountsApplied: false, priceSource: 'internal-source-reference',
  });
  const appointments = [
    { id: 'frozen', priceAtBooking: 80, quoteJson: null, durationAtBooking: 60 },
    { id: 'free', priceAtBooking: 0, quoteJson: null, durationAtBooking: 45 },
    { id: 'legacy', priceAtBooking: null, quoteJson: null, durationAtBooking: null },
    { id: 'nhs', priceAtBooking: '44.99', quoteJson: nhsQuote, durationAtBooking: 90 },
  ].map((snapshot) => ({
    ...snapshot, date: new Date('2099-09-15T10:00:00Z'), status: 'CONFIRMED',
    stylistId: 'stylist-1', stylist: { name: 'Stylist' }, serviceId: 'service-1',
    service: { name: 'Cut', price: 120, duration: 30 }, review: null,
    treatwellBookingId: 'provider-private-reference', treatwellSyncError: 'internal diagnostic',
  }));
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
  type Card = { id: string; service: Record<string, unknown> & { duration: number }; price: Record<string, unknown> & { known: boolean; amountPence?: number } };
  const cards: Card[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as { type: unknown; props: { appointment?: Card; children?: unknown } };
    if (element.type === card && element.props.appointment) cards.push(element.props.appointment);
    visit(element.props.children);
  };
  visit(rendered);
  // A booking without a recorded amount is UNKNOWN — never today's £120 and never £0.
  assert.deepEqual(cards.map(({ id, price, service }) => [id, price.known ? price.amountPence : 'unknown', service.duration]), [
    ['frozen', 8000, 60], ['free', 0, 45], ['legacy', 'unknown', 30], ['nhs', 4499, 90],
  ]);
  assert.deepEqual(cards.find((c) => c.id === 'nhs')!.price, { known: true, amountPence: 4499, priceType: 'NHS', vatDisplay: 'EXCLUDED', priceNature: 'LISTED' });
  assert.deepEqual(cards.find((c) => c.id === 'legacy')!.price, { known: false });
  assert.ok(cards.every((appointment) => !('price' in appointment.service)), 'the live service price never reaches the page');
  assert.ok(cards.every((appointment) => !('treatwellSyncError' in appointment) && !('treatwellBookingId' in appointment)));
  assert.ok(cards.every((appointment) => !('quote' in appointment.price) && !('serviceId' in appointment.price)), 'only display facts of the quote are sent');
});
