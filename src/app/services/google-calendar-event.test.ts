import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_APPOINTMENT_PROPERTY, googleEventIdFor, renderGoogleEvent, sameRenderedEvent, stylistColorId,
  type RenderableAppointment,
} from './google-calendar-event';
import { ERASED_CUSTOMER_NAME } from '../lib/customer-erasure';

const appt: RenderableAppointment = {
  id: 'appt-1',
  date: new Date('2026-10-20T09:00:00Z'), // 10:00 BST
  status: 'CONFIRMED',
  notes: 'Wants a fringe',
  durationMin: 60,
  customer: { name: 'Chan Tai Man', phone: '07700 900123', erased: false },
  stylist: { id: 's1', name: 'Ivan' },
  serviceName: 'Haircut',
  deposit: { state: 'HELD', amountPence: 1500 },
};
const ctx = { locale: 'en-GB' as const, adminDayUrl: 'https://www.harbourhair.co.uk/admin?date=2026-10-20', colorId: '3' };

test('event id is 42 chars, hh + base32hex, stable and distinct', () => {
  const id = googleEventIdFor('appt-1');
  assert.equal(id.length, 42);
  assert.match(id, /^hh[0-9a-v]{40}$/);
  assert.equal(googleEventIdFor('appt-1'), id);
  assert.notEqual(googleEventIdFor('appt-2'), id);
});

test('renders an English event', () => {
  const { event } = renderGoogleEvent(appt, ctx);
  assert.equal(event.id, googleEventIdFor('appt-1'));
  assert.equal(event.summary, 'Ivan · Chan Tai Man · Haircut');
  assert.equal(event.status, 'confirmed');
  assert.equal(event.transparency, 'opaque');
  assert.equal(event.colorId, '3');
  assert.equal(event.start?.timeZone, 'Europe/London');
  assert.equal(event.end?.timeZone, 'Europe/London');
  assert.equal(new Date(event.start!.dateTime!).getTime(), appt.date.getTime());
  assert.equal(new Date(event.end!.dateTime!).getTime(), appt.date.getTime() + 3_600_000);
  assert.match(event.start!.dateTime!, /^2026-10-20T10:00:00\+01:00$/);
  assert.equal(event.extendedProperties?.private?.[GOOGLE_APPOINTMENT_PROPERTY], 'appt-1');
  const lines = event.description!.split('\n');
  assert.ok(lines.includes('Phone: 07700 900123'));
  assert.ok(lines.includes('Notes: Wants a fringe'));
  assert.ok(lines.includes('Status: Confirmed'));
  assert.ok(lines.includes('Deposit: £15.00 held on the card, not taken'));
  assert.ok(lines.includes(`Open in Admin: ${ctx.adminDayUrl}`));
  assert.ok(lines.includes('Change this booking in Admin. Changes made here are undone.'));
});

test('renders a PENDING request in Chinese with the request prefix', () => {
  const { event } = renderGoogleEvent({ ...appt, status: 'PENDING' }, { ...ctx, locale: 'zh-HK' });
  assert.equal(event.summary, '[待確認] Ivan · Chan Tai Man · Haircut');
  assert.ok(event.description!.includes('電話：07700 900123'));
  assert.ok(event.description!.includes('狀態：預約申請，尚未確認'));
  assert.ok(event.description!.includes('在後台修改此預約'));
  const en = renderGoogleEvent({ ...appt, status: 'PENDING' }, ctx).event;
  assert.equal(en.summary, '[Request] Ivan · Chan Tai Man · Haircut');
});

test('an erased customer renders the anonymised name and no phone', () => {
  const { event } = renderGoogleEvent(
    { ...appt, customer: { name: ERASED_CUSTOMER_NAME, phone: '07700 900123', erased: true }, notes: null },
    ctx,
  );
  assert.equal(event.summary, `Ivan · ${ERASED_CUSTOMER_NAME} · Haircut`);
  assert.ok(!event.description!.includes('07700'));
  assert.ok(!event.description!.includes('Phone'));
  assert.ok(!event.description!.includes('Notes'));
});

test('no deposit and no name render sensibly', () => {
  const { event } = renderGoogleEvent({ ...appt, deposit: null, customer: { name: null, phone: null, erased: false } }, ctx);
  assert.equal(event.summary, 'Ivan · Name not given · Haircut');
  assert.ok(!event.description!.includes('Deposit'));
});

test('the hash is stable and changes with every rendered field', () => {
  const base = renderGoogleEvent(appt, ctx).hash;
  assert.equal(renderGoogleEvent(appt, ctx).hash, base);
  assert.match(base, /^[0-9a-f]{64}$/);
  const variants: Record<string, [RenderableAppointment, typeof ctx]> = {
    time: [{ ...appt, date: new Date('2026-10-20T09:30:00Z') }, ctx],
    duration: [{ ...appt, durationMin: 90 }, ctx],
    notes: [{ ...appt, notes: 'x' }, ctx],
    status: [{ ...appt, status: 'COMPLETED' }, ctx],
    phone: [{ ...appt, customer: { ...appt.customer, phone: '1' } }, ctx],
    deposit: [{ ...appt, deposit: { state: 'PAID', amountPence: 1500 } }, ctx],
    stylist: [{ ...appt, stylist: { id: 's1', name: 'Lox' } }, ctx],
    service: [{ ...appt, serviceName: 'Colour' }, ctx],
    colour: [appt, { ...ctx, colorId: '4' }],
    locale: [appt, { ...ctx, locale: 'zh-HK' }],
    url: [appt, { ...ctx, adminDayUrl: 'https://x.test/' }],
  };
  for (const [name, [a, c]] of Object.entries(variants)) {
    assert.notEqual(renderGoogleEvent(a, c).hash, base, name);
  }
});

test('stylistColorId follows sorted ids and cycles 1..11', () => {
  assert.equal(stylistColorId(['b', 'a', 'c'], 'a'), '1');
  assert.equal(stylistColorId(['b', 'a', 'c'], 'c'), '3');
  const many = Array.from({ length: 13 }, (_, i) => `s${String(i).padStart(2, '0')}`);
  assert.equal(stylistColorId(many, 's10'), '11');
  assert.equal(stylistColorId(many, 's11'), '1');
  assert.equal(stylistColorId(['a'], 'unknown'), '1');
});

test('sameRenderedEvent compares what the salon can edit', () => {
  const { event } = renderGoogleEvent(appt, ctx);
  assert.equal(sameRenderedEvent({ ...event }, event), true);
  // Same instants in another offset notation, and Google's default status.
  assert.equal(sameRenderedEvent({
    ...event, status: undefined,
    start: { dateTime: '2026-10-20T09:00:00Z' }, end: { dateTime: '2026-10-20T10:00:00Z' },
  }, event), true);
  assert.equal(sameRenderedEvent({ ...event, summary: 'Other' }, event), false);
  assert.equal(sameRenderedEvent({ ...event, description: 'Other' }, event), false);
  assert.equal(sameRenderedEvent({ ...event, colorId: '9' }, event), false);
  assert.equal(sameRenderedEvent({ ...event, status: 'cancelled' }, event), false);
  assert.equal(sameRenderedEvent({ ...event, start: { dateTime: '2026-10-20T11:00:00+01:00' } }, event), false);
  assert.equal(sameRenderedEvent({ ...event, end: { date: '2026-10-21' } }, event), false);
  assert.equal(sameRenderedEvent({ ...event, start: undefined }, event), false);
});
