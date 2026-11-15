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
    id, name, duration: 45, category: 'Styling', requiresPatchTest: false, requiresConsultation: false, amountPence, priceVersion: 1,
    priceType: 'STANDARD', hairLength: null, vatDisplay: 'EXCLUDED', priceNature: 'LISTED', isBookable: true, offeringId: null, ...extra,
  };
}

const SERVICES = [
  service('blow-dry', 'Blow Dry', 4000, { priceVersion: 3, offeringId: 'blow-dry-offering', offering: { name: 'Blow Dry', searchText: 'blow dry' } }),
  service('blow-dry-nhs', 'Blow Dry (NHS)', 3500, { priceType: 'NHS', hairLength: 'LONG', offeringId: 'blow-dry-offering', offering: { name: 'Blow Dry', searchText: 'blow dry' } }),
  // An unverified legacy option: still on old bookings, closed to new ones.
  service('legacy', 'Blow Dry (Student & NHS)', 3000, { priceType: 'NHS', isBookable: false, vatDisplay: 'UNSPECIFIED' }),
];

/** "Re-check payment" (DepositRecheckButton.tsx has its own test): found by type in the tree. */
const Recheck = () => null;
/** "Mark refund as settled outside the website" (DepositSettleRefundButton.tsx has its own test). */
const SettleOutside = () => null;
/** The consultation credit offer (ConsultationCreditOption.tsx has its own test). */
const CreditOption = () => null;

/** Renders the dialog with an in-memory draft store, so a re-render sees every update. */
function dialog(
  target: DialogTarget,
  actions: Record<string, (input: Record<string, unknown>) => Promise<unknown>>,
  services: DialogService[] = SERVICES,
  /** What useConsultationCreditPreview answers for a lookup (its own test covers the asking). */
  creditPreview: (lookup: unknown) => unknown = (lookup) => (lookup ? { state: 'checking' } : { state: 'idle' }),
  /** markArrived (actions/admin-arrivals.ts): answers, or rejects. */
  markArrived: (id: string, arrived: boolean) => Promise<unknown> = async () => ({ success: true }),
) {
  let locale: 'en-GB' | 'zh-HK' = 'en-GB';
  const lookups: unknown[] = [];
  const store = new Map<string, unknown>();
  const calls: Record<string, unknown>[] = [];
  const statusCalls: unknown[][] = [];
  const arrivalCalls: [string, boolean][] = [];
  /** Every value a state setter was given (setError, setSaving…), in order. */
  const stateSets: unknown[] = [];
  const events = { saved: 0, refreshed: 0 };
  const { AppointmentDialog } = loadServerModule<typeof import('./AppointmentDialog')>('src/components/admin/AppointmentDialog.tsx', {
    react: {
      useEffect: () => undefined, useRef: (value: unknown) => ({ current: value }),
      useState: (value: unknown) => [typeof value === 'function' ? (value as () => unknown)() : value, (next: unknown) => stateSets.push(next)],
    },
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace), useLocale: () => locale },
    './RescheduleRequestActions': { RescheduleRequestActions: () => null },
    './DepositRecheckButton': { DepositRecheckButton: Recheck },
    './DepositSettleRefundButton': { DepositSettleRefundButton: SettleOutside },
    './ConsultationCreditOption': {
      ConsultationCreditOption: CreditOption,
      useConsultationCreditPreview: (lookup: unknown) => { lookups.push(lookup); return creditPreview(lookup); },
    },
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
    '@/app/actions/admin': {
      updateAppointmentStatus: async (...args: unknown[]) => { statusCalls.push(args); return { success: true }; },
    },
    '@/app/actions/admin-arrivals': {
      markArrived: async (id: string, arrived: boolean) => { arrivalCalls.push([id, arrived]); return markArrived(id, arrived); },
    },
  });
  const render = () => elements(AppointmentDialog({
    target, services, stylists: [{ id: 's1', name: 'Ivan' }], onClose: () => undefined,
    onSaved: () => { events.saved++; }, onRefresh: () => { events.refreshed++; },
  }));
  /** Edit the open draft the way the dialog's own controls would (e.g. picking a search result). */
  const patchDraft = (patch: Record<string, unknown>) => {
    const key = `schedule-dialog:${target.mode === 'edit' ? target.appointmentId : 'new'}`;
    store.set(key, { ...(store.get(key) as Record<string, unknown>), ...patch });
  };
  return { render, calls, patchDraft, statusCalls, lookups, arrivalCalls, stateSets, events, setLocale: (next: 'en-GB' | 'zh-HK') => { locale = next; } };
}

const submitButton = (nodes: Element[]) => nodes.filter((node) => node.type === 'button').at(-1)!;
const options = (nodes: Element[], id: string) => elements(nodes.find((node) => node.props.id === id)).filter((node) => node.type === 'option');

test('a new booking offers only bookable options, shows the price, and sends the price it showed', async () => {
  const { render, calls } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '10:00' }, {
    create: async () => ({ success: true, appointmentId: 'new' }),
  });
  let nodes = render();
  assert.deepEqual(options(nodes, 'appt-service').map((node) => node.props.value), ['blow-dry', 'blow-dry-nhs']);
  assert.match(text(options(nodes, 'appt-service')[1]), /Long hair · NHS price \(45 mins, £35\.00\)/);
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
    date: '2099-09-15T09:00:00.000Z', rescheduleRequestedDate: null, rescheduleRequestedAt: null,
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

test('the dialog offers no Approve once the booking\'s original time has passed', () => {
  const base: DialogTarget = {
    mode: 'edit', appointmentId: 'appt-1', dateStr: '2099-09-15', time: '10:00', stylistId: 's1', serviceId: 'blow-dry',
    durationMin: 45, notes: '', customerName: 'Mei', status: 'CONFIRMED', updatedAt: '2099-09-01T00:00:00.000Z', price: { known: false },
    date: '2099-09-15T09:00:00.000Z', rescheduleRequestedDate: '2099-09-20T09:00:00.000Z', rescheduleRequestedAt: '2099-09-01T10:00:00.000Z',
  };
  const expiredProp = (target: DialogTarget) => {
    const actions = dialog(target, {}).render().find((node) => 'requestedAt' in node.props && 'expired' in node.props);
    assert.ok(actions, 'the request controls are rendered');
    return actions.props.expired;
  };
  assert.equal(expiredProp(base), false, 'original and requested time both ahead');
  assert.equal(expiredProp({ ...base, dateStr: '2020-01-15', date: '2020-01-15T10:00:00.000Z' }), true, 'the visit already happened');
});

const MEI = { id: 'user-9', name: 'Mei', email: 'mei@example.test', phone: null };

test('a customer on file with no saved language is asked for one, and the choice is sent with the booking', async () => {
  const { render, calls, patchDraft } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '10:00' }, {
    create: async () => ({ success: true, appointmentId: 'new' }),
  });
  render();
  patchDraft({ picked: { ...MEI, preferredLocale: null } });
  let nodes = render();
  const language = nodes.find((node) => node.props.id === 'appt-customer-locale');
  assert.ok(language, 'the language select is offered');
  assert.equal(language.props.value, 'en-GB', 'English unless the admin changes it');
  assert.match(text(nodes), /no saved email language yet/);
  (language.props.onChange as (event: unknown) => void)({ target: { value: 'zh-HK' } });
  nodes = render();

  await (submitButton(nodes).props.onClick as () => Promise<void>)();
  assert.deepEqual(calls[0].customer, { kind: 'existing', userId: 'user-9' });
  assert.equal(calls[0].customerLocale, 'zh-HK');
});

test('a customer on file with a saved language is shown it and never asked', async () => {
  const { render, calls, patchDraft } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '10:00' }, {
    create: async () => ({ success: true, appointmentId: 'new' }),
  });
  render();
  patchDraft({ picked: { ...MEI, preferredLocale: 'zh-HK' }, customerLocale: 'en-GB' });
  const nodes = render();
  assert.equal(nodes.find((node) => node.props.id === 'appt-customer-locale'), undefined);
  assert.match(text(nodes), /Emails go out in 繁體中文/);

  await (submitButton(nodes).props.onClick as () => Promise<void>)();
  assert.equal(calls[0].customerLocale, undefined, 'their own saved language is used, not the dialog\'s');
});

// Cancelling a booking that holds a card deposit (actions/admin.ts
// updateAppointmentStatus): a confirmed booking's taken deposit is refunded
// unless staff untick the box; a request's hold is always released.
const depositTarget = (status: string, deposit: { state: string; amountPence: number }): DialogTarget => ({
  mode: 'edit', appointmentId: 'appt-1', dateStr: '2099-09-15', time: '10:00', stylistId: 's1', serviceId: 'blow-dry',
  durationMin: 45, notes: '', customerName: 'Mei', status, updatedAt: '2099-09-01T00:00:00.000Z', price: { known: false },
  date: '2099-09-15T09:00:00.000Z', rescheduleRequestedDate: null, rescheduleRequestedAt: null, deposit: deposit as never,
});

async function pressCancel(nodes: Element[]) {
  const asked: string[] = [];
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { confirm: (message: string) => { asked.push(message); return true; } };
  try {
    const button = nodes.find((node) => node.type === 'button' && text(node) === 'Cancel booking');
    assert.ok(button, 'the dialog offers Cancel booking');
    await (button.props.onClick as () => Promise<void>)();
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
  return asked;
}

test('cancelling a confirmed booking with a taken deposit refunds it by default; unticking keeps it', async () => {
  const { render, statusCalls } = dialog(depositTarget('CONFIRMED', { state: 'PAID', amountPence: 2000 }), {});
  let nodes = render();
  const chip = nodes.find((node) => typeof node.type === 'function' && 'deposit' in node.props);
  assert.deepEqual(chip?.props.deposit, { state: 'PAID', amountPence: 2000 }, 'the deposit chip');
  assert.deepEqual(nodes.filter((node) => node.type === Recheck).map((node) => node.props), [{ appointmentId: 'appt-1' }], 'Re-check payment, next to the chip');
  const box = nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox');
  assert.ok(box, 'the refund choice is offered');
  assert.equal(box.props.checked, true, 'ticked by default');
  assert.match(text(nodes), /Refund the £20\.00 deposit/);
  assert.deepEqual(await pressCancel(nodes), ['Cancel Mei’s booking and refund the £20.00 deposit? This releases the appointment time.']);
  assert.deepEqual(statusCalls.at(-1), ['appt-1', 'CANCELLED', { refundDeposit: true }]);

  // A successful cancel closes the dialog; staff who keep the deposit untick first.
  const keeping = dialog(depositTarget('CONFIRMED', { state: 'PAID', amountPence: 2000 }), {});
  nodes = keeping.render();
  (nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox')!.props.onChange as (event: unknown) => void)({ target: { checked: false } });
  nodes = keeping.render();
  assert.equal(nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox')!.props.checked, false);
  assert.deepEqual(await pressCancel(nodes), ['Cancel Mei’s booking and keep the £20.00 deposit? This releases the appointment time.']);
  assert.deepEqual(keeping.statusCalls, [['appt-1', 'CANCELLED', { refundDeposit: false }]]);
});

test('cancelling a request releases its hold: no refund choice, and the dialog says so', async () => {
  const { render, statusCalls } = dialog(depositTarget('PENDING', { state: 'HELD', amountPence: 2000 }), {});
  const nodes = render();
  assert.equal(nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox'), undefined);
  assert.match(text(nodes), /Cancelling releases the £20\.00 hold on the customer’s card\./);
  assert.deepEqual(await pressCancel(nodes), ['Cancel Mei’s request? The £20.00 hold on their card will be released and the appointment time freed.']);
  assert.deepEqual(statusCalls.at(-1), ['appt-1', 'CANCELLED', { refundDeposit: true }]);
});

test('a booking without a deposit cancels as before', async () => {
  const target = depositTarget('CONFIRMED', { state: 'PAID', amountPence: 2000 });
  delete (target as { deposit?: unknown }).deposit;
  const { render, statusCalls } = dialog(target, {});
  const nodes = render();
  assert.equal(nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox'), undefined);
  assert.equal(nodes.find((node) => node.type === Recheck), undefined, 'no deposit, nothing to re-check');
  assert.deepEqual(await pressCancel(nodes), ['Cancel Mei’s booking? This releases the appointment time.']);
  assert.deepEqual(statusCalls.at(-1), ['appt-1', 'CANCELLED', { refundDeposit: true }]);
});

// Review W-C (c): the booking's payment panel offers "Mark refund as settled
// outside the website" for a refund Square has not confirmed — and only then.
test('a refund Square has not confirmed can be marked settled outside the website from the payment panel', () => {
  const stuck = dialog(depositTarget('CANCELLED', { state: 'REFUND_PENDING', amountPence: 2000, refundToSettle: { id: 'refund-1', amountPence: 2000 } } as never), {});
  const nodes = stuck.render();
  assert.deepEqual(nodes.filter((node) => node.type === SettleOutside).map((node) => node.props), [{ appointmentId: 'appt-1', refund: { id: 'refund-1', amountPence: 2000 } }]);
  assert.equal(nodes.filter((node) => node.type === Recheck).length, 1, 'next to Re-check payment');
  // Square is still handling it, or it is done: nothing to settle by hand. The
  // control stays mounted (offered no refund) so a recorded answer outlives the refresh.
  for (const deposit of [{ state: 'REFUND_PENDING', amountPence: 2000 }, { state: 'REFUNDED', amountPence: 2000 }, { state: 'PAID', amountPence: 2000 }]) {
    assert.equal(dialog(depositTarget('CANCELLED', deposit), {}).render().find((node) => node.type === SettleOutside)?.props.refund, null, deposit.state);
  }
});

// The Arrived / Not arrived toggle (late-arrival rule). Final review M3: clearing
// an arrival once the start is 15 minutes past asks first — the next run may
// cancel the booking. F6: a failed request shows an error and refreshes the
// board instead of reaching the error boundary.
const arrivalTarget = (startMinutesAgo: number, arrivedAt: string | null): DialogTarget => ({
  mode: 'edit', appointmentId: 'appt-1', dateStr: '2099-09-15', time: '10:00', stylistId: 's1', serviceId: 'blow-dry',
  durationMin: 45, notes: '', customerName: 'Mei', status: 'CONFIRMED', updatedAt: '2099-09-01T00:00:00.000Z', price: { known: false },
  rescheduleRequestedDate: null, rescheduleRequestedAt: null, deposit: null, arrivedAt,
  date: new Date(Date.now() - startMinutesAgo * 60_000).toISOString(),
});

async function pressArrival(nodes: Element[], label: string, answer = true) {
  const asked: string[] = [];
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { confirm: (message: string) => { asked.push(message); return answer; } };
  try {
    const button = nodes.find((node) => node.type === 'button' && text(node) === label);
    assert.ok(button, `the dialog offers ${label}`);
    await (button.props.onClick as () => Promise<void>)();
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
  return asked;
}

const CLEAR_CONFIRM = 'This booking is already past its 15-minute mark. If you mark it not arrived, it may be cancelled automatically. Continue?';

test('clearing an arrival past the 15-minute mark asks first; declining changes nothing', async () => {
  const declined = dialog(arrivalTarget(20, new Date().toISOString()), {});
  assert.deepEqual(await pressArrival(declined.render(), 'Not arrived', false), [CLEAR_CONFIRM]);
  assert.deepEqual(declined.arrivalCalls, [], 'nothing sent');

  const accepted = dialog(arrivalTarget(20, new Date().toISOString()), {});
  assert.deepEqual(await pressArrival(accepted.render(), 'Not arrived'), [CLEAR_CONFIRM]);
  assert.deepEqual(accepted.arrivalCalls, [['appt-1', false]]);
  assert.equal(accepted.events.saved, 1);
  assert.match(translator('zh-HK', 'adminSchedule')('arrivals.clearArrivedConfirm', { minutes: 15 }), /15 分鐘/);

  // Before the mark, or marking arrived at any time: no question.
  const early = dialog(arrivalTarget(10, new Date().toISOString()), {});
  assert.deepEqual(await pressArrival(early.render(), 'Not arrived'), []);
  assert.deepEqual(early.arrivalCalls, [['appt-1', false]]);
  const arriving = dialog(arrivalTarget(20, null), {});
  assert.deepEqual(await pressArrival(arriving.render(), 'Arrived'), []);
  assert.deepEqual(arriving.arrivalCalls, [['appt-1', true]]);
});

test('a failed arrival request shows an error and refreshes the board, never throws', async () => {
  const rejected = dialog(arrivalTarget(20, null), {}, SERVICES, undefined, async () => { throw new Error('network down'); });
  await pressArrival(rejected.render(), 'Arrived');
  assert.ok(rejected.stateSets.includes('Failed to update'), 'the generic error is shown');
  assert.deepEqual([rejected.events.saved, rejected.events.refreshed], [0, 1]);
  assert.equal(rejected.stateSets.at(-1), false, 'the dialog is usable again');

  // A refusal still shows the server's own text.
  const refused = dialog(arrivalTarget(20, null), {}, SERVICES, undefined, async () => ({ success: false, error: 'This appointment has changed. Please refresh and try again.' }));
  await pressArrival(refused.render(), 'Arrived');
  assert.ok(refused.stateSets.includes('This appointment has changed. Please refresh and try again.'));
  assert.equal(refused.events.refreshed, 1);
});

// Consultation credit (spec 2026-10-16 §2.3): for a consultation-required
// service the dialog offers the credit the server finds, and sends the box only
// once it was shown for the current customer, service and time.
const COLOUR = service('colour', 'Full Colour', 8000, { category: 'Colour', requiresConsultation: true });
const WITH_COLOUR = [...SERVICES, COLOUR];
const creditOption = (nodes: Element[]) => nodes.find((node) => node.type === CreditOption);
const choose = (nodes: Element[], serviceId: string) =>
  (nodes.find((node) => node.props.id === 'appt-service')!.props.onChange as (event: unknown) => void)({ target: { value: serviceId } });
const refused = async () => ({ success: false, error: 'Kept open' });
const save = async (nodes: Element[]) => (submitButton(nodes).props.onClick as () => Promise<void>)();
const sent = (call: Record<string, unknown>) => ('applyConsultationCredit' in call ? call.applyConsultationCredit : 'omitted');
const toggle = (nodes: Element[], apply: boolean) => (creditOption(nodes)!.props.onApplyChange as (apply: boolean) => void)(apply);

const CHECKING = { state: 'checking' };
const FAILED = { state: 'failed' };
const AVAILABLE = { state: 'answered', preview: { available: true, amountPence: 1500, consultationDate: '2099-10-01T09:00:00.000Z' } };
const NONE_LEFT = { state: 'answered', preview: { available: false } };

test('a new booking offers the picked customer\'s credit, ticked, and sends the box only once it was shown', async () => {
  let answer: unknown = CHECKING;
  const { render, calls, patchDraft, lookups } = dialog({ mode: 'create', dateStr: '2099-10-15', time: '11:00' }, { create: refused }, WITH_COLOUR, () => answer);
  render();
  patchDraft({ picked: { ...MEI, preferredLocale: 'en-GB' } });
  let nodes = render();
  assert.equal(creditOption(nodes), undefined, 'a service that needs no consultation takes no credit');
  assert.equal(lookups.at(-1), null);
  await save(nodes);
  assert.equal(sent(calls[0]), 'omitted');

  choose(nodes, 'colour');
  nodes = render();
  assert.deepEqual(lookups.at(-1), { customerId: 'user-9', serviceId: 'colour', dateStr: '2099-10-15', time: '11:00' });
  assert.deepEqual(creditOption(nodes)!.props.preview, CHECKING);
  await save(nodes);
  assert.equal(sent(calls[1]), 'omitted', 'saved before the preview answered: no credit nobody saw');

  answer = AVAILABLE;
  nodes = render();
  assert.equal(creditOption(nodes)!.props.apply, true, 'ticked by default');
  await save(nodes);
  assert.equal(sent(calls[2]), true);

  toggle(nodes, false);
  nodes = render();
  assert.equal(creditOption(nodes)!.props.apply, false);
  await save(nodes);
  assert.equal(sent(calls[3]), false);

  // Another time is another question: the box starts ticked again.
  (nodes.find((node) => node.props.id === 'appt-time')!.props.onChange as (event: unknown) => void)({ target: { value: '15:00' } });
  nodes = render();
  assert.equal(creditOption(nodes)!.props.apply, true);

  answer = FAILED;
  nodes = render();
  await save(nodes);
  assert.equal(sent(calls[4]), 'omitted', 'a preview that failed changes nothing');
});

test('a new customer is asked about by the email typed for them, and not at all without one', () => {
  const { render, patchDraft, lookups } = dialog({ mode: 'create', dateStr: '2099-10-15', time: '11:00' }, { create: refused }, WITH_COLOUR);
  render();
  patchDraft({ serviceId: 'colour', customerQuery: 'Mei', name: 'Mei' });
  render();
  assert.equal(lookups.at(-1), null);
  patchDraft({ email: 'mei@exam' });
  render();
  assert.equal(lookups.at(-1), null, 'not until it looks like an address');
  patchDraft({ email: ' mei@example.test ' });
  render();
  assert.deepEqual(lookups.at(-1), { email: 'mei@example.test', serviceId: 'colour', dateStr: '2099-10-15', time: '11:00' });
});

const RECORDED = { amountPence: 1500, consultationDate: '2099-10-01T09:00:00.000Z' };
const colourBooking = (consultationCredit: typeof RECORDED | null): DialogTarget => ({
  mode: 'edit', appointmentId: 'appt-1', dateStr: '2099-10-15', time: '11:00', stylistId: 's1', serviceId: 'colour',
  durationMin: 45, notes: '', customerName: 'Mei', status: 'CONFIRMED', updatedAt: '2099-09-01T00:00:00.000Z',
  price: { known: true, amountPence: 8000, priceType: 'STANDARD', vatDisplay: 'EXCLUDED', priceNature: 'LISTED' },
  date: '2099-10-15T10:00:00.000Z', rescheduleRequestedDate: null, rescheduleRequestedAt: null, consultationCredit,
});

test('editing a booking with a recorded credit keeps it unless the box or the server says otherwise', async () => {
  let answer: unknown = CHECKING;
  const { render, calls, lookups } = dialog(colourBooking(RECORDED), { edit: refused }, WITH_COLOUR, () => answer);
  let nodes = render();
  assert.deepEqual(lookups.at(-1), { appointmentId: 'appt-1', serviceId: 'colour', dateStr: '2099-10-15', time: '11:00' });
  assert.deepEqual(creditOption(nodes)!.props.recorded, RECORDED);
  assert.equal(creditOption(nodes)!.props.apply, true, 'starts as the booking stands');
  await save(nodes);
  assert.equal(sent(calls[0]), 'omitted', 'saved before the preview answered: the recorded credit stays');

  answer = AVAILABLE;
  await save(render());
  assert.equal(sent(calls[1]), true, 'shown and ticked: re-checked');

  answer = NONE_LEFT;
  await save(render());
  assert.equal(sent(calls[2]), false, '"saving removes it" was shown');

  answer = FAILED;
  await save(render());
  assert.equal(sent(calls[3]), 'omitted');

  nodes = render();
  choose(nodes, 'blow-dry');
  nodes = render();
  assert.equal(creditOption(nodes), undefined);
  assert.match(text(nodes), /This service needs no consultation, so saving removes the £15\.00 consultation credit\./);
  await save(nodes);
  assert.equal(sent(calls[4]), 'omitted', 'the service change clears it on the server');
});

test('editing a booking without a credit never adds an available one unless staff tick the box', async () => {
  const { render, calls } = dialog(colourBooking(null), { edit: refused }, WITH_COLOUR, () => AVAILABLE);
  let nodes = render();
  assert.equal(creditOption(nodes)!.props.apply, false, 'starts unticked');
  await save(nodes);
  assert.equal(sent(calls[0]), false, 'a notes or stylist edit gets no credit');

  toggle(nodes, true);
  nodes = render();
  await save(nodes);
  assert.equal(sent(calls[1]), true);
});

// Final review M1: Save waits for the credit answer, so staff never save a
// consultation-required booking before seeing whether a credit applies.
test('Save is disabled while the consultation credit is being checked, and only then', () => {
  let answer: unknown = CHECKING;
  const { render, patchDraft } = dialog({ mode: 'create', dateStr: '2099-10-15', time: '11:00' }, { create: refused }, WITH_COLOUR, () => answer);
  render();
  patchDraft({ picked: { ...MEI, preferredLocale: 'en-GB' } });
  let nodes = render();
  assert.equal(submitButton(nodes).props.disabled, false, 'a service that needs no consultation: nothing to wait for');

  choose(nodes, 'colour');
  nodes = render();
  assert.equal(submitButton(nodes).props.disabled, true, 'checking');
  for (const settled of [AVAILABLE, NONE_LEFT, FAILED]) {
    answer = settled;
    assert.equal(submitButton(render()).props.disabled, false, JSON.stringify(settled));
  }

  // No customer yet: nothing is being checked, so nothing to wait for.
  const fresh = dialog({ mode: 'create', dateStr: '2099-10-15', time: '11:00' }, { create: refused }, WITH_COLOUR, (lookup) => (lookup ? CHECKING : { state: 'idle' }));
  fresh.render();
  fresh.patchDraft({ serviceId: 'colour' });
  assert.equal(submitButton(fresh.render()).props.disabled, false);

  // Editing waits too.
  const edit = dialog(colourBooking(RECORDED), { edit: refused }, WITH_COLOUR, () => CHECKING);
  assert.equal(submitButton(edit.render()).props.disabled, true);
});

test('clearing the minutes leaves the box empty, so typing a new length never shows a leading 0', async () => {
  const { render, calls } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '10:00' }, {
    create: async () => ({ success: true, appointmentId: 'new' }),
  });
  const minutes = () => render().find((node) => node.props.id === 'appt-duration')!;
  const type = (value: string) => (minutes().props.onChange as (event: unknown) => void)({ target: { value } });
  assert.equal(minutes().props.value, '45');

  // A number box shown 0 keeps it when typing on: "0" then "120" reads "0120".
  type('');
  assert.equal(minutes().props.value, '');
  type('120');
  assert.equal(minutes().props.value, '120');

  const nodes = render();
  (nodes.find((node) => node.type === 'input' && node.props.placeholder === 'Search name, phone or email…')!.props.onChange as (event: unknown) => void)({ target: { value: 'Mei' } });
  await (submitButton(render()).props.onClick as () => Promise<void>)();
  assert.equal(calls[0].durationMin, 120);
});


test('minutes normalizes leading zeroes, preserves blank editing and previews the actual end time', async () => {
  const { render, calls, patchDraft } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '10:00' }, { create: refused });
  render();
  patchDraft({ name: 'Mei' });
  const change = (value: string) => (render().find((node) => node.props.id === 'appt-duration')!.props.onChange as (event: unknown) => void)({ target: { value } });
  change('00120');
  let nodes = render();
  const input = nodes.find((node) => node.props.id === 'appt-duration')!;
  assert.equal(input.props.value, '120');
  assert.equal(input.props.type, 'text');
  assert.equal(input.props.inputMode, 'numeric');
  assert.match(text(nodes), /Ends at 12:00/);
  await save(nodes);
  assert.equal(calls[0].durationMin, 120);
  change('');
  nodes = render();
  assert.equal(nodes.find((node) => node.props.id === 'appt-duration')!.props.value, '');
  assert.doesNotMatch(text(nodes), /Ends at/);
  await save(nodes);
  assert.equal(calls.length, 1, 'blank never reaches the server action');
});

test('invalid minute values cannot save, while 15, 55, 85 and 720 submit as whole minutes', async () => {
  const { render, calls, patchDraft } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '10:00' }, { create: refused });
  render();
  patchDraft({ name: 'Mei' });
  for (const invalid of ['', '0', '14', '721', '-15', '1.5', '1e2', 'abc']) {
    patchDraft({ durationMin: invalid });
    const nodes = render();
    assert.equal(submitButton(nodes).props.disabled, true, invalid);
    assert.ok(nodes.find((node) => node.props.id === 'appt-duration-error'), 'inline error is visible before saving');
    await save(nodes);
  }
  assert.equal(calls.length, 0);
  for (const valid of ['15', '55', '85', '720']) {
    patchDraft({ durationMin: valid });
    assert.equal(submitButton(render()).props.disabled, false);
    await save(render());
  }
  assert.deepEqual(calls.map((call) => call.durationMin), [15, 55, 85, 720]);
  patchDraft({ durationMin: 85 });
  assert.equal(render().find((node) => node.props.id === 'appt-duration')!.props.value, '85', 'older numeric drafts still restore');
});


test('service selection groups by offering ID, filters locally, and only shows actual options', () => {
  const rows = [
    service('short-standard', 'English option one', 3000, { offeringId: 'cut', offering: { name: '剪髮', searchText: 'haircut 剪髮' }, hairLength: 'SHORT' } as Partial<DialogService>),
    service('long-nhs', 'English option two', 4000, { offeringId: 'cut', offering: { name: '剪髮', searchText: 'haircut 剪髮' }, hairLength: 'LONG', priceType: 'NHS' } as Partial<DialogService>),
    service('colour', 'Colour option', 8000, { offeringId: 'colour', offering: { name: '全頭染髮', searchText: 'full colour 全頭染髮' }, category: 'Colouring' } as Partial<DialogService>),
    service('single', 'Consultation', 1500),
    service('retired-nhs', 'Retired option', 2000, { offeringId: 'cut', isBookable: false }),
  ];
  const { render } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '10:00' }, {}, rows);
  let nodes = render();
  assert.deepEqual(options(nodes, 'appt-offering').filter((node) => node.props.value).map(text), ['剪髮', '全頭染髮', 'Consultation']);
  assert.deepEqual(options(nodes, 'appt-service').map((node) => node.props.value), ['short-standard', 'long-nhs']);
  assert.match(text(options(nodes, 'appt-service')), /Short hair.*Standard price.*Long hair.*NHS price/);
  assert.equal(options(nodes, 'appt-service').length, 2, 'no short NHS or long standard choice is invented');
  const search = nodes.find((node) => node.props.id === 'appt-service-search')!;
  (search.props.onChange as (event: unknown) => void)({ target: { value: 'full colour' } });
  nodes = render();
  assert.deepEqual(options(nodes, 'appt-offering').filter((node) => node.props.value).map(text), ['全頭染髮'], 'English aliases still find a translated offering');
  assert.equal(options(nodes, 'appt-service').length, 0, 'previous options do not appear under a different search');
  (nodes.find((node) => node.props.id === 'appt-offering')!.props.onChange as (event: unknown) => void)({ target: { value: 'offering:colour' } });
  nodes = render();
  assert.equal(nodes.find((node) => node.props.id === 'appt-service')!.props.value, 'colour');
  assert.equal(nodes.find((node) => node.props.id === 'appt-duration')!.props.value, '45');
  (nodes.find((node) => node.props.id === 'appt-service-search')!.props.onChange as (event: unknown) => void)({ target: { value: '' } });
  (nodes.find((node) => node.props.id === 'appt-service-category')!.props.onChange as (event: unknown) => void)({ target: { value: 'Styling' } });
  nodes = render();
  assert.deepEqual(options(nodes, 'appt-offering').filter((node) => node.props.value).map(text), ['剪髮', 'Consultation']);
  (nodes.find((node) => node.props.id === 'appt-service-search')!.props.onChange as (event: unknown) => void)({ target: { value: 'no such service' } });
  assert.match(text(render()), /No services match/);
});


test('locale changes restore minute text and the preview identifies a next-day finish', () => {
  const { render, patchDraft, setLocale } = dialog({ mode: 'create', dateStr: '2099-09-15', time: '23:00' }, {});
  render();
  patchDraft({ durationMin: '85', serviceSearch: 'blow' });
  assert.match(text(render()), /Ends at 00:25 the next day/);
  setLocale('zh-HK');
  let nodes = render();
  assert.equal(nodes.find((node) => node.props.id === 'appt-duration')!.props.value, '85');
  assert.equal(nodes.find((node) => node.props.id === 'appt-service-search')!.props.value, 'blow');
  assert.match(text(nodes), /翌日 00:25 結束/);
  patchDraft({ durationMin: '' });
  setLocale('en-GB');
  nodes = render();
  assert.equal(nodes.find((node) => node.props.id === 'appt-duration')!.props.value, '');
  assert.equal(submitButton(nodes).props.disabled, true);
});

test('resizing a retired option retains the price recorded on the booking', async () => {
  const target = { ...depositTarget('CONFIRMED', { state: 'PAID', amountPence: 2000 }), serviceId: 'legacy', price: { known: true, amountPence: 1234, priceType: 'STANDARD', vatDisplay: 'EXCLUDED', priceNature: 'LISTED' } } as DialogTarget;
  const { render, calls, patchDraft } = dialog(target, { edit: refused });
  render();
  patchDraft({ durationMin: '85' });
  const nodes = render();
  assert.match(text(nodes), /Recorded price£12.34/);
  await save(nodes);
  assert.equal(calls[0].serviceId, 'legacy');
  assert.equal(calls[0].durationMin, 85);
  assert.equal(calls[0].expectedQuote, undefined);
});

// Staff open a booking to reach the customer about it: the phone and email
// are links (tap to call, tap to email), and a booking with neither says so.
test('an opened booking shows the customer phone and email as call and email links', () => {
  const contact = { ...depositTarget('PENDING', { state: 'AUTHORIZED', amountPence: 2000 }) as Extract<DialogTarget, { mode: 'edit' }>, customerPhone: '07700 900123', customerEmail: 'mei@example.test' };
  const nodes = dialog(contact, {}).render();
  const links = nodes.filter((node) => node.type === 'a').map((node) => [node.props.href, text(node)]);
  assert.deepEqual(links.filter(([href]) => String(href).startsWith('tel:')), [['tel:+447700900123', '07700 900123']], 'the phone dials in international form');
  assert.deepEqual(links.filter(([href]) => String(href).startsWith('mailto:')), [['mailto:mei@example.test', 'mei@example.test']], 'the email opens a new mail');
  assert.ok(!nodes.some((node) => text(node) === 'No phone or email on file for this customer.'), 'no missing-contact note');

  const bare = dialog(depositTarget('CONFIRMED', { state: 'PAID', amountPence: 2000 }), {}).render();
  assert.ok(!bare.some((node) => node.type === 'a' && /^(tel|mailto):/.test(String(node.props.href))), 'no contact links without contact details');
  assert.ok(bare.some((node) => node.type === 'p' && text(node) === 'No phone or email on file for this customer.'), 'the missing-contact note');
});
