import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

type Element = { type: unknown; props: Record<string, unknown> };
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

function card(locale: Locale, price: unknown, isUpcoming = true) {
  const loaded = loadServerModule<typeof import('../../components/appointments/AppointmentCard')>('src/components/appointments/AppointmentCard.tsx', {
    react: { useState: (value: unknown) => [typeof value === 'function' ? (value as () => unknown)() : value, () => undefined] },
    'next/navigation': { useRouter: () => ({ refresh: () => undefined }) },
    '@/app/actions/booking': { cancelAppointment: async () => ({}), withdrawRescheduleRequest: async () => ({}) },
    '@/i18n/link': { __esModule: true, default: (props: Record<string, unknown>) => ({ type: 'a', props }) },
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace), useLocale: () => locale },
    '@/i18n/draft-store': { useDraftState: (_key: string, value: unknown) => [value, () => undefined] },
    '@/components/pricing/PriceParts': { useFormatPrice: () => (pence: number) => `£${(pence / 100).toFixed(2)}` },
    './RescheduleModal': { RescheduleModal: () => null },
  });
  const appointment = {
    id: 'a1', date: '2099-09-14T12:00:00.000Z', status: 'CONFIRMED', stylist: { name: 'Ivan' }, stylistId: 's1',
    service: { name: 'Cut', duration: 60 }, serviceId: 'svc', price, request: { state: 'none' },
  };
  return text(loaded.AppointmentCard({ appointment: appointment as never, isUpcoming, bookingEnabled: true }));
}

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`${locale}: My Bookings shows the proof-of-eligibility note for an NHS booking only`, () => {
    const note = translator(locale, 'pricing')('eligibilityProof');
    const known = (priceType: string | null) => ({ known: true, amountPence: 4500, priceType, vatDisplay: null, priceNature: null });
    assert.ok(card(locale, known('NHS')).includes(note));
    assert.ok(!card(locale, known('STANDARD')).includes(note));
    assert.ok(!card(locale, known(null)).includes(note));
    assert.ok(!card(locale, { known: false }).includes(note));
    // A past or closed booking no longer needs the reminder.
    assert.ok(!card(locale, known('NHS'), false).includes(note));
  });
}
