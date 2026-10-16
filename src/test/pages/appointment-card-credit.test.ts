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

function card(locale: Locale, extra: Record<string, unknown>, price: unknown = { known: true, amountPence: 10000, priceType: null, vatDisplay: null, priceNature: null }, isUpcoming = true) {
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
    service: { name: 'Cut', duration: 60 }, serviceId: 'svc', price, request: { state: 'none' }, ...extra,
  };
  return text(loaded.AppointmentCard({ appointment: appointment as never, isUpcoming, bookingEnabled: true }));
}

const words = {
  'en-GB': {
    credit: 'Consultation credit: −£15.00', toPay: (amount: string) => `To pay in the salon: ${amount}`,
    toPayAfterConsultation: 'To pay in the salon: £85.00 (VAT excluded · Final price confirmed at your consultation)',
  },
  'zh-HK': {
    credit: '諮詢費抵扣：−£15.00', toPay: (amount: string) => `到店繳付：${amount}`,
    toPayAfterConsultation: '到店繳付：£85.00（未含 VAT · 最終價錢於諮詢時確定）',
  },
} as const;

for (const locale of ['en-GB', 'zh-HK'] as const) {
  const w = words[locale];
  test(`${locale}: My Bookings shows the consultation credit and what is left to pay in the salon`, () => {
    const withCredit = card(locale, { consultationCreditPence: 1500 });
    assert.ok(withCredit.includes(w.credit), withCredit);
    assert.ok(withCredit.includes(w.toPay('£85.00')));
    // A taken deposit comes off as well; one only held on the card does not.
    assert.ok(card(locale, { consultationCreditPence: 1500, deposit: { state: 'PAID', amountPence: 2000 } }).includes(w.toPay('£65.00')));
    assert.ok(card(locale, { consultationCreditPence: 1500, deposit: { state: 'HELD', amountPence: 2000 } }).includes(w.toPay('£85.00')));
    // Never below £0 (deposit + credit can exceed the price).
    assert.ok(card(locale, { consultationCreditPence: 1500, deposit: { state: 'PAID', amountPence: 9000 } }).includes(w.toPay('£0.00')));
    // An unknown price has no remainder to show; the credit row still does.
    const unknown = card(locale, { consultationCreditPence: 1500 }, { known: false });
    assert.ok(unknown.includes(w.credit));
    assert.ok(!unknown.includes(w.toPay('£0.00')) && !unknown.includes(w.toPay('£85.00')));
  });

  test(`${locale}: a booking with no credit shows neither row, and a past one shows no remainder`, () => {
    const none = card(locale, {});
    assert.ok(!none.includes(w.credit.split('：')[0].split(':')[0]));
    assert.ok(!none.includes(w.toPay('£100.00')));
    assert.ok(!card(locale, { consultationCreditPence: null }).includes(w.credit));
    const past = card(locale, { consultationCreditPence: 1500, status: 'COMPLETED' }, undefined, false);
    assert.ok(past.includes(w.credit));
    assert.ok(!past.includes(w.toPay('£85.00')));
  });
}

for (const locale of ['en-GB', 'zh-HK'] as const) {
  const w = words[locale];
  // Final review I2: what is left to pay carries the price's own fine print,
  // so a consultation-required price never reads as a fixed amount.
  test(`${locale}: what is left to pay says the final price is confirmed at the consultation`, () => {
    const afterConsultation = card(locale, { consultationCreditPence: 1500 }, { known: true, amountPence: 10000, priceType: 'STANDARD', vatDisplay: 'EXCLUDED', priceNature: 'SUBJECT_TO_CONSULTATION' });
    assert.ok(afterConsultation.includes(w.toPayAfterConsultation), afterConsultation);
    // An exact price: the line as before, no brackets.
    const exact = card(locale, { consultationCreditPence: 1500 }, { known: true, amountPence: 10000, priceType: 'STANDARD', vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED' });
    assert.ok(exact.includes(w.toPay('£85.00')) && !exact.includes(`${w.toPay('£85.00')} (`) && !exact.includes(`${w.toPay('£85.00')}（`), exact);
  });

  // Final review M2: a cancelled booking deducts nothing, so it shows no credit.
  test(`${locale}: a cancelled booking shows no consultation credit`, () => {
    for (const isUpcoming of [true, false]) {
      const cancelled = card(locale, { consultationCreditPence: 1500, status: 'CANCELLED' }, undefined, isUpcoming);
      assert.ok(!cancelled.includes(w.credit), cancelled);
      assert.ok(!cancelled.includes(w.toPay('£85.00')));
    }
  });
}
