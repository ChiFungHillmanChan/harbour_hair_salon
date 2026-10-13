import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const words = (nodes: Element[]) => nodes.flatMap((node) => [node.props.children].flat().filter((child) => typeof child === 'string')).join(' ');

const SERVICE = {
  id: 'service-1', name: 'Cut', translated: true, offeringId: null, hairLength: null, duration: 60, amountPence: 4000, priceVersion: 1,
  priceType: 'STANDARD', vatDisplay: 'INCLUDED', priceNature: 'LISTED', isBookable: true, isPublic: true, requiresConsultation: false,
  isConsultation: false, isPatchTest: false, requiresPatchTest: false, searchText: 'cut',
};
const STYLIST = { id: 'lox', name: 'Lox', role: 'Stylist', imageUrl: null, translated: true };

/**
 * The wizard with its state supplied: `draft` holds the in-memory draft values
 * (keyed like `booking-wizard:<name>`, by <name>) and every draft setter call
 * is recorded. Effects never run, so nothing is fetched.
 */
function loadWizard(draft: Record<string, unknown>, submitBooking: (input: unknown) => Promise<unknown> = async () => ({ success: true })) {
  const sets: Record<string, unknown[]> = {};
  const initial = (value: unknown) => (typeof value === 'function' ? (value as () => unknown)() : value);
  const wizard = loadServerModule<typeof import('./BookingWizard')>('src/components/booking/BookingWizard.tsx', {
    react: {
      useState: (value: unknown) => [initial(value), () => undefined],
      useEffect: () => undefined,
      useMemo: (factory: () => unknown) => factory(),
      useRef: (current: unknown) => ({ current }),
    },
    '@/i18n/draft-store': {
      useDraftState: (key: string, value: unknown) => {
        const name = key.split(':')[1];
        return [name in draft ? draft[name] : initial(value), (next: unknown) => { (sets[name] ??= []).push(next); }];
      },
      clearDraft: () => undefined,
    },
    '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace), useLocale: () => 'en-GB' },
    '@/i18n/link': { __esModule: true, default: (props: Record<string, unknown>) => ({ type: 'a', props }) },
    '@/app/actions/booking': { fetchBookingDays: async () => ({ ok: true, days: [] }), submitBooking },
    '@/app/actions/booking-quote': { previewBookingQuote: async () => ({ ok: false }) },
    './DayAvailability': { DayChip: () => null, TimeSlotGrid: () => null, UnavailableDayBlock: () => null },
    './BookingClosedNotice': { BookingClosedNotice: () => null },
    './DepositCardForm': { DepositCardForm: () => null },
    './DepositSummary': { DepositRows: () => null, DepositTerms: () => null, PaymentUnavailableNotice: () => null },
    '@/components/pricing/PriceParts': {
      Duration: () => null, OptionLabel: () => null, PriceFinePrint: () => null, SurchargeBreakdown: () => null,
      useCategoryLabel: () => (category: string) => category, useFormatPrice: () => (pence: number) => `£${(pence / 100).toFixed(2)}`,
    },
  });
  const props = { services: [SERVICE], offerings: [], categories: [], stylists: [STYLIST], closedContact: { phone: '0113 496 0000', marketplaces: [] } };
  return { render: () => wizard.BookingWizard(props as never), sets };
}

const ALREADY = 'You already have a request for this time — see My Bookings.';
const HELD = 'We’ve placed a £20.00 hold on your card. It is only taken if the salon confirms your booking.';

test('the success screen says so when the request had already been made, and points to My Bookings', () => {
  const repeat = elements(loadWizard({ submitted: true, alreadyRequested: true }).render());
  assert.ok(words(repeat).includes('Booking Request Received!'));
  assert.ok(words(repeat).includes(ALREADY));
  assert.ok(repeat.some((node) => node.props.href === '/appointments' && node.props.children === 'View My Bookings'), 'the My Bookings button is still there');
  assert.ok(!words(elements(loadWizard({ submitted: true }).render())).includes(ALREADY), 'a new request says nothing of the kind');
  // A replay of the submission that placed a card hold says both.
  const replayed = words(elements(loadWizard({ submitted: true, alreadyRequested: true, held: 2000 }).render()));
  assert.ok(replayed.includes(ALREADY) && replayed.includes(HELD), replayed);
});

test('the wizard keeps what the server said: already requested, or a new request', async () => {
  const confirmStep = { step: 'CONFIRM', service: 'service-1', stylist: 'lox', day: '2026-10-06', time: '11:00' };
  for (const [answer, already] of [
    [{ success: true, alreadyRequested: true }, true],
    [{ success: true }, false],
    [{ success: true, alreadyRequested: true, depositHeldPence: 2000 }, true],
    [{ success: true, depositHeldPence: 2000 }, false],
  ] as const) {
    const { render, sets } = loadWizard(confirmStep, async () => answer);
    const [form] = elements(render()).filter((node) => node.type === 'form');
    assert.ok(form, 'the confirm step renders its form');
    await (form.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
    assert.deepEqual(sets.submitted, [true], JSON.stringify(answer));
    assert.deepEqual(sets.alreadyRequested, [already], JSON.stringify(answer));
    assert.deepEqual(sets.held, ['depositHeldPence' in answer ? answer.depositHeldPence : null], JSON.stringify(answer));
  }
});

test('the already-requested line exists in both languages', () => {
  assert.equal(translator('en-GB', 'booking')('done.alreadyRequested'), ALREADY);
  assert.equal(translator('zh-HK', 'booking')('done.alreadyRequested'), '你已為這個時間提交過預約申請——請到「我的預約」查看。');
});

// --- The card deposit path, with state ---------------------------------------
//
// A minimal hook runtime: state, refs and memos persist between renders by
// call order (as in React), effects run after a render when their
// dependencies change, and `settle` re-renders until nothing changes. The
// wizard's own child components are stand-ins whose props the tests read.

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

const DepositRows = (props: unknown) => props;
const DepositTerms = (props: unknown) => props;
const PaymentUnavailableNotice = (props: unknown) => props;
const DepositCardForm = (props: unknown) => props;

const DAY = '2099-10-06';
const TIME = '11:00';
const CONFIRM = { step: 'CONFIRM', service: 'service-1', stylist: 'lox', day: DAY, time: TIME };
const OPEN_DAY = { date: DAY, status: 'OPEN', hours: { start: '09:00', end: '18:00' }, slots: [{ time: TIME, available: true }] };
const SQUARE = { applicationId: 'sandbox-sq0idb-app', locationId: 'location-1', environment: 'sandbox' };
const DUE = { ok: true, amountPence: 4000, depositPence: 2000, remainderPence: 2000 };
const errors = translator('en-GB', 'errors');
const booking = translator('en-GB', 'booking');

type Answer = Record<string, unknown>;
type Submitted = { expectedDepositPence?: number; paymentToken?: string; attemptKey?: string };

function mountWizard(options: { draft: Record<string, unknown>; preview?: unknown; answers?: Answer[] }) {
  const slots: unknown[] = [];
  const setters: ((next: unknown) => void)[] = [];
  const memos: { deps: unknown[]; value: unknown }[] = [];
  const effects: { deps?: unknown[]; cleanup?: () => void }[] = [];
  let queue: { slot: number; run: () => unknown }[] = [];
  let index = 0;
  let dirty = false;
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const update = (read: () => unknown, write: (value: unknown) => void) => (next: unknown) => {
    const value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(read()) : next;
    if (!Object.is(value, read())) { write(value); dirty = true; }
  };
  const react = {
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) {
        slots[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
        setters[slot] = update(() => slots[slot], (value) => { slots[slot] = value; });
      }
      return [slots[slot], setters[slot]];
    },
    useRef(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const slot = index++;
      if (!memos[slot] || !same(memos[slot].deps, deps)) memos[slot] = { deps, value: factory() };
      return memos[slot].value;
    },
    useEffect(run: () => unknown, deps?: unknown[]) {
      const slot = index++;
      if (!effects[slot] || !deps || !same(effects[slot].deps, deps)) {
        effects[slot] = { ...effects[slot], deps };
        queue.push({ slot, run });
      }
    },
  };
  const draft: Record<string, unknown> = { ...options.draft };
  const draftSetters: Record<string, (next: unknown) => void> = {};
  const submissions: Submitted[] = [];
  const previews: string[] = [];
  let daysCalls = 0;
  const answers = [...(options.answers ?? [])];
  const wizard = loadServerModule<typeof import('./BookingWizard')>('src/components/booking/BookingWizard.tsx', {
    react,
    '@/i18n/draft-store': {
      useDraftState: (key: string, initial: unknown) => {
        const name = key.split(':')[1];
        if (!(name in draft)) draft[name] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
        draftSetters[name] ??= update(() => draft[name], (value) => { draft[name] = value; });
        return [draft[name], draftSetters[name]];
      },
      clearDraft: () => undefined,
    },
    '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace), useLocale: () => 'en-GB' },
    '@/i18n/link': { __esModule: true, default: (props: Record<string, unknown>) => ({ type: 'a', props }) },
    '@/app/actions/booking': {
      fetchBookingDays: async () => { daysCalls++; return { ok: true, days: [OPEN_DAY] }; },
      submitBooking: async (input: Submitted) => { submissions.push(input); return answers.shift() ?? { success: true }; },
    },
    '@/app/actions/booking-quote': { previewBookingQuote: async (serviceId: string) => { previews.push(serviceId); return options.preview ?? DUE; } },
    './DayAvailability': { DayChip: () => null, TimeSlotGrid: () => null, UnavailableDayBlock: () => null },
    './BookingClosedNotice': { BookingClosedNotice: () => null },
    './DepositCardForm': { DepositCardForm },
    './DepositSummary': { DepositRows, DepositTerms, PaymentUnavailableNotice },
    '@/components/pricing/PriceParts': {
      Duration: () => null, OptionLabel: () => null, PriceFinePrint: () => null, SurchargeBreakdown: () => null,
      useCategoryLabel: () => (category: string) => category, useFormatPrice: () => (pence: number) => `£${(pence / 100).toFixed(2)}`,
    },
  });
  const props = {
    services: [SERVICE], offerings: [], categories: [], stylists: [STYLIST], closedContact: { phone: '0113 496 0000', marketplaces: [] },
    payment: { square: SQUARE, payer: { name: 'Ada Lovelace', email: 'ada@example.test' } },
  };
  let tree: unknown = null;
  async function settle(): Promise<unknown> {
    for (let round = 0; round < 25; round++) {
      index = 0;
      dirty = false;
      tree = wizard.BookingWizard(props as never);
      const run = queue;
      queue = [];
      for (const effect of run) {
        effects[effect.slot].cleanup?.();
        const cleanup = effect.run();
        effects[effect.slot].cleanup = typeof cleanup === 'function' ? cleanup as () => void : undefined;
      }
      await new Promise((resolve) => setImmediate(resolve));
      if (!dirty && queue.length === 0) return tree;
    }
    throw new Error('the wizard never settled');
  }
  const onSubmit = () => elements(tree).find((node) => node.type === 'form')!.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>;
  return {
    settle,
    /** Press the submit button and let everything settle. */
    async submit() {
      await onSubmit()({ preventDefault() {} });
      return settle();
    },
    /** Press it without waiting for the answer. */
    startSubmit: () => onSubmit()({ preventDefault() {} }),
    submissions,
    previews,
    get daysCalls() { return daysCalls; },
  };
}

const byType = (tree: unknown, type: unknown) => elements(tree).find((node) => node.type === type);
const submitButton = (tree: unknown) => elements(tree).find((node) => node.type === 'button' && node.props.type === 'submit')!;
const alertText = (tree: unknown) => text(elements(tree).find((node) => node.props.role === 'alert'));

/** A card field whose tokenize answers in turn from `tokens` (then 'cnon:ok'), recording the verification details. */
function fakeCard(tokens: (string | null | Promise<string | null>)[] = []) {
  const asked: { amount: string }[] = [];
  const card = {
    tokenize: async (details: { amount: string }) => { asked.push(details); return tokens.length ? tokens.shift()! : 'cnon:ok'; },
    destroy: async () => undefined,
  };
  return { card, asked };
}

async function withCardReady(wizard: ReturnType<typeof mountWizard>, card: unknown) {
  const tree = await wizard.settle();
  (byType(tree, DepositCardForm)!.props.onCardChange as (card: unknown) => void)(card);
  return wizard.settle();
}

test('a deposit booking states the obligation to pay on its button, and waits for Square’s card field', async () => {
  const wizard = mountWizard({ draft: CONFIRM });
  let tree = await wizard.settle();
  assert.deepEqual(wizard.previews, ['service-1'], 'the review step reads the deposit for the chosen service');
  assert.equal(text(submitButton(tree)), 'Request booking – pay £20.00 deposit if confirmed');
  assert.equal(submitButton(tree).props.disabled, true, 'no card field yet: nothing can be sent');
  // What the deposit means is said before the card form.
  const order = elements(tree).map((node) => node.type);
  assert.ok(order.indexOf(DepositTerms) >= 0 && order.indexOf(DepositTerms) < order.indexOf(DepositCardForm));
  const terms = byType(tree, DepositTerms)!.props;
  assert.deepEqual([terms.amount, terms.startsWithin24Hours], ['£20.00', false]);
  assert.equal(byType(tree, DepositRows)!.props.depositPence, 2000);

  tree = await withCardReady(wizard, fakeCard().card);
  assert.equal(submitButton(tree).props.disabled, false, 'the card field is ready');
  assert.equal(text(submitButton(tree)), 'Request booking – pay £20.00 deposit if confirmed');
});

test('at a new price the button still says the deposit is paid only if confirmed', async () => {
  const quote = { serviceId: 'service-1', priceVersion: 2, amountPence: 4500, priceType: 'STANDARD', vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED', breakdown: null };
  const repriced = mountWizard({ draft: { ...CONFIRM, reprice: quote } });
  assert.equal(text(submitButton(await repriced.settle())), 'Confirm new price – pay £20.00 deposit if confirmed');
  // No deposit due: the buttons are as they were.
  const none = { ok: true, amountPence: 4500, depositPence: 0, remainderPence: 4500 };
  assert.equal(text(submitButton(await mountWizard({ draft: { ...CONFIRM, reprice: quote }, preview: none }).settle())), 'Confirm at the new price');
  assert.equal(text(submitButton(await mountWizard({ draft: CONFIRM, preview: none }).settle())), 'Confirm Booking');
});

test('the rest to pay carries the price’s fine print: the price facts reach the deposit rows', async () => {
  const quote = { serviceId: 'service-1', priceVersion: 2, amountPence: 4000, priceType: 'STANDARD', vatDisplay: 'EXCLUDED', priceNature: 'SUBJECT_TO_CONSULTATION', breakdown: null };
  const price = byType(await mountWizard({ draft: { ...CONFIRM, reprice: quote } }).settle(), DepositRows)!.props.price as Record<string, unknown>;
  assert.deepEqual([price.vatDisplay, price.priceNature], ['EXCLUDED', 'SUBJECT_TO_CONSULTATION']);
});

test('a card Square does not accept (no token) is never submitted', async () => {
  const wizard = mountWizard({ draft: CONFIRM });
  const { card, asked } = fakeCard([null]);
  await withCardReady(wizard, card);
  const tree = await wizard.submit();
  assert.deepEqual(asked.map((details) => details.amount), ['20.00'], 'Square was asked to verify exactly the deposit shown');
  assert.deepEqual(wizard.submissions, [], 'nothing reaches the server');
  assert.equal(alertText(tree), booking('deposit.cardInvalid'));
  assert.equal(submitButton(tree).props.disabled, false, 'the customer can correct the card and try again');
});

test('a deposit that changed (QUOTE_CHANGED) is shown again, and the next confirm is a new card check for the new amount', async () => {
  const changed = { success: false, code: 'QUOTE_CHANGED', error: errors('booking.QUOTE_CHANGED'), deposit: { amountPence: 4000, depositPence: 1500, remainderPence: 2500 } };
  const wizard = mountWizard({ draft: CONFIRM, answers: [changed, { success: true, depositHeldPence: 1500 }] });
  const { card, asked } = fakeCard();
  await withCardReady(wizard, card);
  let tree = await wizard.submit();
  assert.equal(alertText(tree), 'The deposit for this booking couldn’t be confirmed or has changed — please check it and try again.');
  assert.equal(byType(tree, DepositRows)!.props.depositPence, 1500);
  assert.equal(text(submitButton(tree)), 'Request booking – pay £15.00 deposit if confirmed');
  assert.equal(wizard.daysCalls, 1, 'an answer about the deposit does not re-read the diary');

  tree = await wizard.submit();
  assert.deepEqual(asked.map((details) => details.amount), ['20.00', '15.00']);
  assert.deepEqual(wizard.submissions.map((input) => input.expectedDepositPence), [2000, 1500]);
  assert.notEqual(wizard.submissions[1].attemptKey, wizard.submissions[0].attemptKey, 'a new card check, a new attempt key');
  assert.ok(words(elements(tree)).includes('Booking Request Received!'));
});

test('PAYMENT_UNAVAILABLE takes the card form away: the salon’s phone instead, and nothing more can be sent', async () => {
  const wizard = mountWizard({ draft: CONFIRM, answers: [{ success: false, code: 'PAYMENT_UNAVAILABLE', error: errors('booking.PAYMENT_UNAVAILABLE') }] });
  await withCardReady(wizard, fakeCard().card);
  const tree = await wizard.submit();
  assert.equal(alertText(tree), errors('booking.PAYMENT_UNAVAILABLE'));
  assert.ok(byType(tree, PaymentUnavailableNotice), 'the phone number replaces the card form');
  assert.equal(byType(tree, DepositCardForm), undefined);
  assert.equal(submitButton(tree).props.disabled, true);
  assert.equal(wizard.daysCalls, 1, 'an answer about payment does not re-read the diary');
});

test('a submission the server is still checking is sent again unchanged once, then dropped with a "reload and try again" hint', async () => {
  const pending = { success: false, code: 'PAYMENT_PENDING', error: errors('booking.PAYMENT_PENDING') };
  const wizard = mountWizard({ draft: CONFIRM, answers: [pending, pending, { success: true, depositHeldPence: 2000 }] });
  const { card, asked } = fakeCard(['cnon:first', 'cnon:second']);
  await withCardReady(wizard, card);

  let tree = await wizard.submit();
  assert.equal(alertText(tree), errors('booking.PAYMENT_PENDING'));
  tree = await wizard.submit();
  assert.equal(asked.length, 1, 'the retry sends the same token: no second card check');
  assert.equal(wizard.submissions[1].attemptKey, wizard.submissions[0].attemptKey);
  assert.equal(wizard.submissions[1].paymentToken, 'cnon:first');
  assert.equal(alertText(tree), 'We still can’t confirm your card payment. Please check My Bookings — if your request isn’t there, reload this page and try again.');

  tree = await wizard.submit();
  assert.equal(asked.length, 2, 'after giving up on it, a new card check');
  assert.equal(wizard.submissions[2].paymentToken, 'cnon:second');
  assert.notEqual(wizard.submissions[2].attemptKey, wizard.submissions[0].attemptKey, 'and a new attempt key');
  assert.ok(words(elements(tree)).includes('Booking Request Received!'));
});

test('a card check that never answers lets go of the page after its time limit, and can be tried again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { SQUARE_TOKENIZE_TIMEOUT_MS } = await import('./square-web-payments');
  const wizard = mountWizard({ draft: CONFIRM });
  let answer: (token: string) => void = () => undefined;
  const tokens: Promise<string | null>[] = [new Promise(() => undefined), new Promise((resolve) => { answer = resolve; })];
  const { card, asked } = fakeCard(tokens);
  await withCardReady(wizard, card);

  const first = wizard.startSubmit();
  let tree = await wizard.settle();
  assert.equal(text(submitButton(tree)), 'Checking your card…');
  assert.equal(submitButton(tree).props.disabled, true);
  t.mock.timers.tick(SQUARE_TOKENIZE_TIMEOUT_MS);
  await first;
  tree = await wizard.settle();
  assert.equal(alertText(tree), booking('confirm.genericError'));
  assert.equal(submitButton(tree).props.disabled, false, 'the button works again');
  assert.deepEqual(wizard.submissions, [], 'nothing was sent without a token');

  // The submission lock was released: pressing again checks the card again.
  const second = wizard.startSubmit();
  await new Promise((resolve) => setImmediate(resolve));
  answer('cnon:ok');
  await second;
  tree = await wizard.settle();
  assert.equal(asked.length, 2);
  assert.equal(wizard.submissions.length, 1);
  assert.ok(words(elements(tree)).includes('Booking Request Received!'));
});

test('a time less than 24 hours away is flagged to the deposit terms; one further away is not', async (t) => {
  // 11:00 in London on 6 October 2099 (BST) is 10:00 UTC.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-10-05T12:00:00Z') });
  assert.equal(byType(await mountWizard({ draft: CONFIRM }).settle(), DepositTerms)!.props.startsWithin24Hours, true, '22 hours away');
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-10-05T09:00:00Z') });
  assert.equal(byType(await mountWizard({ draft: CONFIRM }).settle(), DepositTerms)!.props.startsWithin24Hours, false, '25 hours away');
});
