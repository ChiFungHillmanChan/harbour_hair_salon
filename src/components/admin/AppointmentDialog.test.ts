import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Namespace } from '../../i18n/messages';
import type { DialogService, DialogTarget } from './AppointmentDialog';

type Element = { type: unknown; props: Record<string, unknown> };

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

function service(id: string, name: string, amountPence: number, extra: Partial<DialogService> = {}): DialogService {
  return {
    id, name, duration: 45, category: 'Styling', requiresPatchTest: false, amountPence, priceVersion: 1,
    priceType: 'STANDARD', hairLength: null, vatDisplay: 'EXCLUDED', priceNature: 'LISTED', isBookable: true, offeringId: null, ...extra,
  };
}

const SERVICES = [
  service('blow-dry', 'Blow Dry', 4000, { priceVersion: 3 }),
  service('blow-dry-nhs', 'Blow Dry (NHS)', 3500, { priceType: 'NHS', hairLength: 'LONG' }),
  // An unverified legacy option: still on old bookings, closed to new ones.
  service('legacy', 'Blow Dry (Student & NHS)', 3000, { priceType: 'NHS', isBookable: false, vatDisplay: 'UNSPECIFIED' }),
];

/** Renders the dialog with an in-memory draft store, so a re-render sees every update. */
function dialog(target: DialogTarget, actions: Record<string, (input: Record<string, unknown>) => Promise<unknown>>) {
  const store = new Map<string, unknown>();
  const calls: Record<string, unknown>[] = [];
  const { AppointmentDialog } = loadServerModule<typeof import('./AppointmentDialog')>('src/components/admin/AppointmentDialog.tsx', {
    react: { useEffect: () => undefined, useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, () => undefined] },
    '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace), useLocale: () => 'en-GB' },
    './RescheduleRequestActions': { RescheduleRequestActions: () => null },
    '@/i18n/draft-store': {
      clearDraft: (key: string) => store.delete(key),
      useDraftState: (key: string, initial: unknown) => {
        if (!store.has(key)) store.set(key, typeof initial === 'function' ? (initial as () => unknown)() : initial);
        return [store.get(key), (next: unknown) => store.set(key, typeof next === 'function' ? (next as (value: unknown) => unknown)(store.get(key)) : next)];
      },
    },
    '@/app/actions/admin-schedule': {
      searchAdminCustomers: async () => [],
      createAppointmentByAdmin: async (input: Record<string, unknown>) => { calls.push(input); return actions.create(input); },
      editAppointmentByAdmin: async (input: Record<string, unknown>) => { calls.push(input); return actions.edit(input); },
    },
  });
  const render = () => elements(AppointmentDialog({
    target, services: SERVICES, stylists: [{ id: 's1', name: 'Ivan' }], onClose: () => undefined, onSaved: () => undefined,
  }));
  return { render, calls };
}

const submitButton = (nodes: Element[]) => nodes.filter((node) => node.type === 'button').at(-1)!;
const options = (nodes: Element[], id: string) => elements(nodes.find((node) => node.props.id === id)).filter((node) => node.type === 'option');

test('a new booking offers only bookable options, shows the price, and sends the price it showed', async () => {
  const { render, calls } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '10:00' }, {
    create: async () => ({ success: true, appointmentId: 'new' }),
  });
  let nodes = render();
  assert.deepEqual(options(nodes, 'appt-service').map((node) => node.props.value), ['blow-dry', 'blow-dry-nhs']);
  assert.match(text(options(nodes, 'appt-service')[1]), /Blow Dry \(NHS\) · Long hair · NHS price \(45 mins, £35\.00\)/);
  assert.match(text(nodes), /Price for this booking£40\.00VAT excluded/);

  // A walk-in's email language is chosen here, English by default.
  const language = nodes.find((node) => node.props.id === 'appt-customer-locale')!;
  assert.equal(language.props.value, 'en-GB');
  (language.props.onChange as (event: unknown) => void)({ target: { value: 'zh-HK' } });
  nodes = render();
  (nodes.find((node) => node.type === 'input' && node.props.placeholder === 'Search name, phone or email…')!.props.onChange as (event: unknown) => void)({ target: { value: 'Mei' } });
  nodes = render();

  await (submitButton(nodes).props.onClick as () => Promise<void>)();
  assert.deepEqual(calls[0].expectedQuote, { serviceId: 'blow-dry', priceVersion: 3, amountPence: 4000 });
  assert.equal(calls[0].customerLocale, 'zh-HK');
});

test('a price that changed while the dialog was open is shown and must be confirmed again, never retried silently', async () => {
  const newer = { serviceId: 'blow-dry', priceVersion: 4, amountPence: 4500, priceType: 'STANDARD', vatDisplay: 'EXCLUDED', priceNature: 'LISTED' };
  const results: unknown[] = [
    { success: false, error: 'The price of this service has changed since you chose it.', quote: newer },
    { success: true, appointmentId: 'new' },
  ];
  const { render, calls } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '10:00' }, { create: async () => results.shift() });
  let nodes = render();
  (nodes.find((node) => node.type === 'input' && node.props.placeholder === 'Search name, phone or email…')!.props.onChange as (event: unknown) => void)({ target: { value: 'Mei' } });
  nodes = render();

  await (submitButton(nodes).props.onClick as () => Promise<void>)();
  assert.equal(calls.length, 1, 'no automatic retry at the new price');
  nodes = render();
  assert.match(text(nodes), /changed to £45\.00/);
  assert.match(text(nodes), /Price for this booking£45\.00/);
  assert.equal(text(submitButton(nodes)), 'Confirm new price and create');

  await (submitButton(nodes).props.onClick as () => Promise<void>)();
  assert.deepEqual(calls[1].expectedQuote, { serviceId: 'blow-dry', priceVersion: 4, amountPence: 4500 });
});

test('editing a booking on a retired option keeps it visible, shows its recorded price, and only re-prices a real change', async () => {
  const target: DialogTarget = {
    mode: 'edit', appointmentId: 'appt-1', dateStr: '2099-09-15', time: '10:00', stylistId: 's1', serviceId: 'legacy',
    durationMin: 45, notes: '', customerName: 'Mei', status: 'CONFIRMED', updatedAt: '2099-09-01T00:00:00.000Z', price: { known: false },
    rescheduleRequestedDate: null, rescheduleRequestedAt: null,
  };
  // Refused, so the dialog stays open (a successful save clears its draft).
  const { render, calls } = dialog(target, { edit: async () => ({ success: false, error: 'This appointment has changed. Please refresh and try again.' }) });
  let nodes = render();
  const legacy = options(nodes, 'appt-service').find((node) => node.props.value === 'legacy');
  assert.ok(legacy, 'the booking\'s own option is still named');
  assert.match(text(legacy), /not offered for new bookings/);
  assert.match(text(nodes), /Recorded pricePrice not recorded/);
  assert.doesNotMatch(text(nodes), /£30\.00(?!\))/, 'today\'s price is never shown as what this booking costs');

  await (submitButton(nodes).props.onClick as () => Promise<void>)();
  assert.equal(calls[0].expectedQuote, undefined, 'moving or re-noting a booking never touches its price');

  (nodes.find((node) => node.props.id === 'appt-service')!.props.onChange as (event: unknown) => void)({ target: { value: 'blow-dry-nhs' } });
  nodes = render();
  assert.match(text(nodes), /New price if you save£35\.00NHS price applied · VAT excluded/);
  await (submitButton(nodes).props.onClick as () => Promise<void>)();
  assert.deepEqual(calls[1].expectedQuote, { serviceId: 'blow-dry-nhs', priceVersion: 1, amountPence: 3500 });
});
