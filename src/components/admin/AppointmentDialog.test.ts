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

/** "Re-check payment" (DepositRecheckButton.tsx has its own test): found by type in the tree. */
const Recheck = () => null;
/** "Mark refund as settled outside the website" (DepositSettleRefundButton.tsx has its own test). */
const SettleOutside = () => null;

/** Renders the dialog with an in-memory draft store, so a re-render sees every update. */
function dialog(
  target: DialogTarget,
  actions: Record<string, (input: Record<string, unknown>) => Promise<unknown>>,
  /** markArrived (actions/admin-arrivals.ts): answers, or rejects. */
  markArrived: (id: string, arrived: boolean) => Promise<unknown> = async () => ({ success: true }),
) {
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
    '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace), useLocale: () => 'en-GB' },
    './RescheduleRequestActions': { RescheduleRequestActions: () => null },
    './DepositRecheckButton': { DepositRecheckButton: Recheck },
    './DepositSettleRefundButton': { DepositSettleRefundButton: SettleOutside },
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
    target, services: SERVICES, stylists: [{ id: 's1', name: 'Ivan' }], onClose: () => undefined,
    onSaved: () => { events.saved++; }, onRefresh: () => { events.refreshed++; },
  }));
  /** Edit the open draft the way the dialog's own controls would (e.g. picking a search result). */
  const patchDraft = (patch: Record<string, unknown>) => {
    const key = `schedule-dialog:${target.mode === 'edit' ? target.appointmentId : 'new'}`;
    store.set(key, { ...(store.get(key) as Record<string, unknown>), ...patch });
  };
  return { render, calls, patchDraft, statusCalls, arrivalCalls, stateSets, events };
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
  const rejected = dialog(arrivalTarget(20, null), {}, async () => { throw new Error('network down'); });
  await pressArrival(rejected.render(), 'Arrived');
  assert.ok(rejected.stateSets.includes('Failed to update'), 'the generic error is shown');
  assert.deepEqual([rejected.events.saved, rejected.events.refreshed], [0, 1]);
  assert.equal(rejected.stateSets.at(-1), false, 'the dialog is usable again');

  // A refusal still shows the server's own text.
  const refused = dialog(arrivalTarget(20, null), {}, async () => ({ success: false, error: 'This appointment has changed. Please refresh and try again.' }));
  await pressArrival(refused.render(), 'Arrived');
  assert.ok(refused.stateSets.includes('This appointment has changed. Please refresh and try again.'));
  assert.equal(refused.events.refreshed, 1);
});
