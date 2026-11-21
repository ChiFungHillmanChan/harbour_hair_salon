import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { readFileSync } from 'node:fs';
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
function loadWizard(draft: Record<string, unknown>, submitBooking: (input: unknown) => Promise<unknown> = async () => ({ success: true }), extraProps: Record<string, unknown> = {}) {
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
    './card-check-client': { sendCardCheckFailure: () => undefined },
    './DayAvailability': { DayChip: () => null, TimeSlotGrid: () => null, UnavailableDayBlock: () => null },
    './BookingClosedNotice': { BookingClosedNotice: () => null },
    './DepositCardForm': { DepositCardForm: () => null },
    './DepositSummary': { DepositRows: () => null, DepositTerms: () => null, PaymentUnavailableNotice: () => null },
    '@/components/pricing/PriceParts': {
      Duration: () => null, OptionLabel: () => null, PriceFinePrint: () => null, SurchargeBreakdown: () => null,
      useCategoryLabel: () => (category: string) => category, useFormatPrice: () => (pence: number) => `£${(pence / 100).toFixed(2)}`,
      useFormatServicePrice: () => (service: { amountPence: number }) => `£${(service.amountPence / 100).toFixed(2)}`,
    },
  });
  const props = { services: [SERVICE], offerings: [], categories: [], stylists: [STYLIST], closedContact: { phone: '0113 496 0000', marketplaces: [] }, customerPhone: '07700 900123', ...extraProps };
  return { render: () => wizard.BookingWizard(props as never), sets };
}

// Effects never run in this harness, so the failed state cannot be reached;
// the source shows the button exists only there and re-runs the days lookup.
test('a failed availability lookup offers a retry, in both languages', () => {
  const source = readFileSync('src/components/booking/BookingWizard.tsx', 'utf8');
  assert.match(source, /slotLoadFailed && \(\s*<button type="button" onClick=\{\(\) => setDaysVersion\(\(version\) => version \+ 1\)\}/);
  assert.equal(translator('en-GB', 'booking')('date.tryAgain'), 'Try again');
  assert.equal(translator('zh-HK', 'booking')('date.tryAgain'), '再試一次');
});

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

// The salon contacts the customer on this number (lib/phone.ts): the
// confirm step asks for it, starting from the account's saved phone, and a
// booking without one is never sent.
test('the confirm step asks for a contact phone, and never sends a booking without one', async () => {
  const confirmStep = { step: 'CONFIRM', service: 'service-1', stylist: 'lox', day: '2026-10-06', time: '11:00' };
  const submit = async (draft: Record<string, unknown>, extraProps: Record<string, unknown> = {}) => {
    const sent: Record<string, unknown>[] = [];
    const { render, sets } = loadWizard(draft, async (input) => { sent.push(input as Record<string, unknown>); return { success: true }; }, extraProps);
    const nodes = elements(render());
    const field = nodes.find((node) => node.type === 'input' && node.props.type === 'tel');
    const [form] = nodes.filter((node) => node.type === 'form');
    await (form.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });
    return { field, sent, sets };
  };

  const saved = await submit(confirmStep);
  assert.equal(saved.field?.props.value, '07700 900123', 'the saved phone fills the field');
  assert.equal(saved.field?.props.required, true);
  assert.equal(saved.sent[0]?.phone, '07700 900123', 'and is sent with the booking');

  const none = await submit(confirmStep, { customerPhone: null });
  assert.equal(none.field?.props.value, '');
  assert.deepEqual(none.sent, [], 'no phone: nothing sent');
  assert.equal(none.sets.submitted, undefined);

  const junk = await submit({ ...confirmStep, phone: 'call me' }, { customerPhone: null });
  assert.deepEqual(junk.sent, [], 'not a phone number: nothing sent');

  const typed = await submit({ ...confirmStep, phone: ' 07700  900456 ' }, { customerPhone: null });
  assert.equal(typed.sent[0]?.phone, '07700 900456', 'a typed phone is sent tidied');
});

test('the contact phone wording exists in both languages', () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const t = translator(locale, 'booking');
    for (const key of ['confirm.phoneLabel', 'confirm.phoneHelp', 'confirm.phoneRequired', 'confirm.phoneInvalid'] as const) {
      assert.ok(t(key).length > 0, `${locale} ${key}`);
    }
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
const TimeSlotGrid = (props: unknown) => props;

const DAY = '2099-10-06';
const TIME = '11:00';
const CONFIRM = { step: 'CONFIRM', service: 'service-1', stylist: 'lox', day: DAY, time: TIME };
const OPEN_DAY = { date: DAY, status: 'OPEN', hours: { start: '09:00', end: '18:00' }, slots: [{ time: TIME, available: true }] };
const SQUARE = { applicationId: 'sandbox-sq0idb-app', locationId: 'location-1', environment: 'sandbox' };
const DUE = { ok: true, amountPence: 4000, depositPence: 2000, remainderPence: 2000 };
const errors = translator('en-GB', 'errors');
const booking = translator('en-GB', 'booking');

/** What submitBooking answers; an Error makes it reject instead. */
type Answer = Record<string, unknown> | Error;
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
  let days: unknown[] = [OPEN_DAY];
  const answers = [...(options.answers ?? [])];
  const reports: Record<string, unknown>[] = [];
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
      fetchBookingDays: async () => { daysCalls++; return { ok: true, days }; },
      submitBooking: async (input: Submitted) => {
        submissions.push(input);
        const answer = answers.shift();
        // An Error answer is a rejected action (dropped connection, server fault).
        if (answer instanceof Error) throw answer;
        return answer ?? { success: true };
      },
    },
    './card-check-client': { sendCardCheckFailure: (failure: Record<string, unknown>, environment: string) => { reports.push({ ...failure, environment }); } },
    '@/app/actions/booking-quote': { previewBookingQuote: async (serviceId: string) => { previews.push(serviceId); return options.preview ?? DUE; } },
    './DayAvailability': { DayChip: () => null, TimeSlotGrid, UnavailableDayBlock: () => null },
    './BookingClosedNotice': { BookingClosedNotice: () => null },
    './DepositCardForm': { DepositCardForm },
    './DepositSummary': { DepositRows, DepositTerms, PaymentUnavailableNotice },
    '@/components/pricing/PriceParts': {
      Duration: () => null, OptionLabel: () => null, PriceFinePrint: () => null, SurchargeBreakdown: () => null,
      useCategoryLabel: () => (category: string) => category, useFormatPrice: () => (pence: number) => `£${(pence / 100).toFixed(2)}`,
      useFormatServicePrice: () => (service: { amountPence: number }) => `£${(service.amountPence / 100).toFixed(2)}`,
    },
  });
  const props = {
    services: [SERVICE], offerings: [], categories: [], stylists: [STYLIST], closedContact: { phone: '0113 496 0000', marketplaces: [] },
    payment: { square: SQUARE, payer: { name: 'Ada Lovelace', email: 'ada@example.test' } },
    customerPhone: '07700 900123',
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
    /** Card step failures the page reported to the server (card-check-client.ts). */
    reports,
    get daysCalls() { return daysCalls; },
    /** The wizard's draft (step, time, …) as it stands. */
    draft,
    /** What the next fortnight read answers. */
    setDays(next: unknown[]) { days = next; },
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
  assert.deepEqual(wizard.reports, [], 'Square’s refusal is reported from inside tokenize (square-web-payments), not twice');
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
  assert.deepEqual(wizard.reports.map((report) => [report.kind, report.errorKind, report.environment]), [['TOKENIZE_TIMEOUT', 'SquareTimeoutError', 'sandbox']], 'the server hears why');

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

// Owner decision 2026-10-18: a deposit is refunded only for a cancellation
// 48 hours or more ahead, so a time already inside 48 hours is flagged too.
test('a time less than 48 hours away is flagged to the deposit terms as inside the refund window; exactly 48 hours is not', async (t) => {
  // The CONFIRM draft's time: 11:00 in London on 6 October 2099 (BST) = 10:00 UTC.
  const flags = async (now: string) => {
    t.mock.timers.reset();
    t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
    const props = byType(await mountWizard({ draft: CONFIRM }).settle(), DepositTerms)!.props;
    return [props.startsWithin24Hours, props.startsWithinRefundNotice];
  };
  assert.deepEqual(await flags('2099-10-05T12:00:00Z'), [true, true], '22 hours away');
  assert.deepEqual(await flags('2099-10-05T09:00:00Z'), [false, true], '25 hours away');
  assert.deepEqual(await flags('2099-10-04T11:00:00Z'), [false, true], '47 hours away');
  assert.deepEqual(await flags('2099-10-04T10:01:00Z'), [false, true], '47h59m away');
  assert.deepEqual(await flags('2099-10-04T10:00:00Z'), [false, false], 'exactly 48 hours away: still refundable');
  assert.deepEqual(await flags('2099-10-03T09:00:00Z'), [false, false], '73 hours away');
});

// Sandbox acceptance, 15 October 2026: of two customers racing for one time,
// the loser's wizard went back to the times with nothing on screen saying why
// (its error lived on the confirm step) — and nothing about the card hold.
const TAKEN = { success: false, code: 'SLOT_UNAVAILABLE', error: errors('booking.SLOT_UNAVAILABLE') };
const TAKEN_DAY = { ...OPEN_DAY, slots: [{ time: TIME, available: false }, { time: '12:00', available: true }] };
const continueButton = (tree: unknown) => elements(tree).find((node) => node.type === 'button' && text(node) === 'Continue')!;

test('a time taken while confirming: back to the times, told it went and that nothing was taken from the card', async () => {
  const wizard = mountWizard({ draft: CONFIRM, answers: [TAKEN] });
  await withCardReady(wizard, fakeCard().card);
  wizard.setDays([TAKEN_DAY]);
  let tree = await wizard.submit();
  assert.deepEqual([wizard.draft.step, wizard.draft.time], ['DATE', null], 'back to the times');
  assert.match(alertText(tree), /^Sorry — 11:00 on .+ is no longer available\. Please choose another time\./);
  assert.match(alertText(tree), /Nothing has been taken from your card/);

  // Another time puts the notice away, and the old refusal does not greet it on the confirm step.
  (byType(tree, TimeSlotGrid)!.props.onSelect as (time: string) => void)('12:00');
  tree = await wizard.settle();
  assert.equal(alertText(tree), '');
  (continueButton(tree).props.onClick as () => void)();
  tree = await wizard.settle();
  assert.equal(wizard.draft.step, 'CONFIRM');
  assert.equal(alertText(tree), '', 'no stale "no longer available" beside the new time');
});

test('with no deposit due, the same notice says nothing about a card', async () => {
  const none = { ok: true, amountPence: 4000, depositPence: 0, remainderPence: 4000 };
  const wizard = mountWizard({ draft: CONFIRM, preview: none, answers: [TAKEN] });
  await wizard.settle();
  wizard.setDays([TAKEN_DAY]);
  const tree = await wizard.submit();
  assert.equal(wizard.draft.step, 'DATE');
  assert.match(alertText(tree), /11:00 on .+ is no longer available/);
  assert.doesNotMatch(alertText(tree), /card/);
});

test('the taken-time notice exists in both languages', () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const t = translator(locale, 'booking');
    assert.ok(t('date.timeTaken', { time: '11:00', date: 'x' }).includes('11:00'), locale);
    assert.ok(t('date.timeTakenCard').length > 0, locale);
  }
});

const ELIGIBILITY = {
  'en-GB': 'NHS and student prices: please bring a valid NHS staff ID or student card to your appointment. Without one, the standard price applies.',
  'zh-HK': 'NHS 及學生價：到店時請出示有效的 NHS 員工證或學生證，否則按標準價收費。',
};

test('the option chooser says what NHS and student prices need only when an NHS option is listed', () => {
  const option = (id: string, priceType: string) => ({ ...SERVICE, id, name: 'Colour', offeringId: 'offering-1', hairLength: 'LONG', priceType });
  const offering = { id: 'offering-1', key: 'colour', category: 'Colouring', name: 'Colour', description: null, translated: true, displayOrder: 0, searchText: 'colour' };
  const chooser = (options: ReturnType<typeof option>[]) => {
    const props = { services: options, offerings: [offering], categories: [{ category: 'Colouring', entries: [{ kind: 'offering', offering, options }] }] };
    return words(elements(loadWizard({ offering: 'offering-1', category: 'Colouring' }, undefined, props).render()));
  };
  const withNhs = chooser([option('s', 'STANDARD'), option('n', 'NHS')]);
  assert.ok(withNhs.includes(ELIGIBILITY['en-GB']), 'an NHS option is listed');
  assert.ok(!chooser([option('s', 'STANDARD')]).includes(ELIGIBILITY['en-GB']), 'standard options only');
  assert.equal(translator('zh-HK', 'pricing')('eligibilityProof'), ELIGIBILITY['zh-HK']);
});

test('the confirm step repeats what an NHS price needs, and says nothing for a standard price', () => {
  const confirm = { step: 'CONFIRM', service: 'service-1', stylist: 'lox', day: '2026-10-06', time: '11:00' };
  const at = (priceType: string) => words(elements(loadWizard(confirm, undefined, { services: [{ ...SERVICE, priceType }] }).render()));
  assert.ok(at('NHS').includes(ELIGIBILITY['en-GB']));
  assert.ok(!at('STANDARD').includes(ELIGIBILITY['en-GB']));
});

// The consultation gate says the consultation's fee comes off the treatment's
// price (spec §2.4); a free consultation has nothing to credit.
test('the consultation gate promises the credit with the consultation’s own price, and says nothing of credit when it is free', () => {
  const treatment = { ...SERVICE, id: 'colour', name: 'Colour', requiresConsultation: true };
  const consultation = (amountPence: number) => ({ ...SERVICE, id: 'consult', name: 'Consultation', isConsultation: true, requiresConsultation: false, price: amountPence / 100, amountPence });
  const gate = (amountPence: number) => {
    const { render } = loadWizard({ gate: 'colour' }, undefined, { services: [{ ...treatment, price: 120 }, consultation(amountPence)] });
    return words(elements(render()));
  };
  assert.ok(gate(1500).includes('This service needs a £15.00 consultation first. If you go ahead with the treatment within 6 months, the £15.00 is taken off its price.'), gate(1500));
  assert.ok(gate(2500).includes('needs a £25.00 consultation first') && gate(2500).includes('the £25.00 is taken off'), 'the consultation’s actual price, never a literal £15');
  const free = gate(0);
  assert.ok(free.includes('We\'ll book you a free consultation to discuss it'), free);
  assert.ok(!free.includes('taken off'));
  // Chinese: written out in both languages, with the months and the fee filled in.
  const zh = translator('zh-HK', 'booking');
  assert.equal(zh('gate.byConsultation', { fee: '£15.00', months: 6 }), '此服務需要先預約 £15.00 諮詢。如你在 6 個月內進行療程，£15.00 會在療程價錢中扣除。');
  assert.equal(zh('gate.byConsultationFree', { fee: zh('gate.freeFee') }), '此服務須先諮詢。我們會為你預約免費諮詢，商討後再為你安排服務。');
});

test('a card accepted but a request that could not be sent is reported, and so is confirming before the card field is ready', async () => {
  const wizard = mountWizard({ draft: CONFIRM, answers: [new Error('Failed to fetch')] });
  const { card } = fakeCard();
  await withCardReady(wizard, card);
  const tree = await wizard.submit();
  assert.equal(alertText(tree), booking('confirm.genericError'));
  assert.deepEqual(wizard.reports.map((report) => [report.kind, report.errorKind, report.detail]), [['SUBMIT_FAILED', 'Error', 'Failed to fetch']]);

  const early = mountWizard({ draft: CONFIRM });
  await early.settle();
  // The button is disabled until the field is ready; a submit that gets
  // through anyway (Enter in the phone field) is told so, and reported.
  const after = await early.submit();
  assert.equal(alertText(after), booking('deposit.cardNotReady'));
  assert.deepEqual(early.reports.map((report) => [report.kind, report.environment]), [['CARD_NOT_READY', 'sandbox']]);
  assert.deepEqual(early.submissions, []);
});
