import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachDepositCard, depositVerificationDetails, loadSquareSdk, mountSquareCard, SQUARE_LOAD_TIMEOUT_MS, SQUARE_SDK_URLS, SQUARE_TOKENIZE_TIMEOUT_MS,
  SquareTimeoutError, withTimeout, type DepositCard, type PageVisibility, type SdkHost, type SquarePublicConfig, type SquareSdk,
} from './square-web-payments';

const CONFIG: SquarePublicConfig = { applicationId: 'sandbox-sq0idb-app', locationId: 'location-1', environment: 'sandbox' };
const ELEMENT = { id: 'card-container' } as unknown as HTMLElement;

type FakeScript = { src: string; async: boolean; onload?: () => void; onerror?: () => void };

/** A page with no Square script yet: records every script it is asked to add. */
function fakePage(square?: SquareSdk) {
  const scripts: FakeScript[] = [];
  const window: SdkHost['window'] = { Square: square };
  const document = {
    createElement: (tag: string) => {
      assert.equal(tag, 'script');
      return { src: '', async: false } as FakeScript;
    },
    head: { appendChild: (script: FakeScript) => { scripts.push(script); } },
  };
  return { host: { document: document as unknown as Document, window }, scripts, window };
}

/** A fake SDK whose card records what the page asks of it. */
function fakeSquare(options: { styledCardFails?: boolean; tokenResult?: { status: string; token?: string }; destroyFails?: boolean } = {}) {
  const calls: unknown[][] = [];
  const card = {
    attach: async (target: unknown) => { calls.push(['attach', target]); },
    tokenize: async (details: unknown) => { calls.push(['tokenize', details]); return options.tokenResult ?? { status: 'OK', token: 'cnon:card-nonce-ok' }; },
    destroy: async () => { calls.push(['destroy']); if (options.destroyFails) throw new Error('already destroyed'); return true; },
  };
  const sdk: SquareSdk = {
    payments: (applicationId, locationId) => {
      calls.push(['payments', applicationId, locationId]);
      return {
        card: async (cardOptions) => {
          calls.push(['card', cardOptions]);
          if (cardOptions && options.styledCardFails) throw new Error('InvalidStylesError');
          return card;
        },
      };
    },
  };
  return { sdk, calls };
}

test('the SDK script is added once per page and environment, from Square’s CDN', async () => {
  const page = fakePage();
  const first = loadSquareSdk('sandbox', page.host);
  const second = loadSquareSdk('sandbox', page.host);
  assert.equal(first, second, 'one load in flight');
  assert.equal(page.scripts.length, 1);
  assert.equal(page.scripts[0].src, 'https://sandbox.web.squarecdn.com/v1/square.js');
  assert.equal(page.scripts[0].async, true);
  const { sdk } = fakeSquare();
  page.window.Square = sdk;
  page.scripts[0].onload!();
  assert.equal(await first, sdk);
  // Loaded: answered from the page, no new script.
  assert.equal(await loadSquareSdk('sandbox', page.host), sdk);
  assert.equal(page.scripts.length, 1);
  assert.equal(SQUARE_SDK_URLS.production, 'https://web.squarecdn.com/v1/square.js');
});

test('a production page loads the production script', () => {
  const page = fakePage();
  void loadSquareSdk('production', page.host);
  assert.deepEqual(page.scripts.map((script) => script.src), ['https://web.squarecdn.com/v1/square.js']);
});

test('a failed script load is reported and forgotten, so the form can try again', async () => {
  const page = fakePage();
  const failed = loadSquareSdk('sandbox', page.host);
  page.scripts[0].onerror!();
  await assert.rejects(failed, /could not be loaded/);
  const retry = loadSquareSdk('sandbox', page.host);
  assert.equal(page.scripts.length, 2);
  // Loaded but the SDK never appeared: also a failure.
  page.scripts[1].onload!();
  await assert.rejects(retry, /did not start/);
});

test('the card field is mounted for the configured application and location, in the salon’s monochrome', async () => {
  const { sdk, calls } = fakeSquare();
  const environments: string[] = [];
  const card = await mountSquareCard(CONFIG, ELEMENT, async (environment) => { environments.push(environment); return sdk; });
  assert.deepEqual(environments, ['sandbox']);
  assert.deepEqual(calls[0], ['payments', 'sandbox-sq0idb-app', 'location-1']);
  const style = (calls[1][1] as { style: Record<string, Record<string, string>> }).style;
  const colours = Object.values(style).flatMap((rule) => Object.values(rule)).filter((value) => value.startsWith('#'));
  assert.ok(colours.length > 0);
  // Zinc greys only: never Square's default blue focus, nor the retired brand colours.
  for (const colour of colours) assert.ok(['#d4d4d8', '#18181b', '#52525b', '#71717a'].includes(colour), colour);
  assert.deepEqual(calls[2], ['attach', ELEMENT]);
  assert.equal(typeof card.tokenize, 'function');
});

test('a style the SDK refuses falls back to the plain card field instead of no card form', async () => {
  const { sdk, calls } = fakeSquare({ styledCardFails: true });
  await mountSquareCard(CONFIG, ELEMENT, async () => sdk);
  assert.deepEqual(calls.filter((call) => call[0] === 'card').map((call) => call[1] === undefined), [false, true]);
  assert.deepEqual(calls.at(-1), ['attach', ELEMENT]);
});

test('tokenize returns Square’s token only for an accepted card', async () => {
  const details = depositVerificationDetails(1250, { name: 'Ada Lovelace', email: 'ada@example.test' });
  const accepted = fakeSquare();
  assert.equal(await (await mountSquareCard(CONFIG, ELEMENT, async () => accepted.sdk)).tokenize(details), 'cnon:card-nonce-ok');
  assert.deepEqual(accepted.calls.find((call) => call[0] === 'tokenize'), ['tokenize', details], 'the verification details go to Square as given');
  for (const tokenResult of [{ status: 'Invalid' }, { status: 'Error' }, { status: 'Cancel' }, { status: 'OK' }, { status: 'OK', token: '' }]) {
    const refused = fakeSquare({ tokenResult });
    assert.equal(await (await mountSquareCard(CONFIG, ELEMENT, async () => refused.sdk)).tokenize(details), null, JSON.stringify(tokenResult));
  }
});

test('destroying the field never throws', async () => {
  const { sdk, calls } = fakeSquare({ destroyFails: true });
  await (await mountSquareCard(CONFIG, ELEMENT, async () => sdk)).destroy();
  assert.deepEqual(calls.at(-1), ['destroy']);
});

test('Square verifies the card against the exact deposit, in GBP, as a customer-initiated charge', () => {
  assert.deepEqual(depositVerificationDetails(1250, { name: 'Mary Ann Smith', email: ' mary@example.test ' }), {
    amount: '12.50', currencyCode: 'GBP', intent: 'CHARGE', customerInitiated: true, sellerKeyedIn: false,
    billingContact: { givenName: 'Mary Ann', familyName: 'Smith', email: 'mary@example.test', countryCode: 'GB' },
  });
  assert.equal(depositVerificationDetails(1, { name: null, email: null }).amount, '0.01');
  assert.deepEqual(depositVerificationDetails(5000, { name: '陳大文', email: null }).billingContact, { givenName: '陳大文', countryCode: 'GB' });
  assert.deepEqual(depositVerificationDetails(5000, { name: '  ', email: '' }).billingContact, { countryCode: 'GB' });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fakeCard() {
  const events: string[] = [];
  const card: DepositCard = { tokenize: async () => 'cnon:ok', destroy: async () => { events.push('destroyed'); } };
  return { card, events };
}

test('a mounted field is reported ready, and removed by the cleanup', async () => {
  const mounting = deferred<DepositCard>();
  const events: unknown[] = [];
  const cleanup = attachDepositCard({
    config: CONFIG, element: ELEMENT, mount: (config, element) => { events.push(['mount', config, element]); return mounting.promise; },
    onReady: (card) => events.push(['ready', card]), onFailed: () => events.push('failed'), onGone: () => events.push('gone'),
  });
  const { card, events: cardEvents } = fakeCard();
  mounting.resolve(card);
  await mounting.promise;
  await Promise.resolve();
  assert.deepEqual(events, [['mount', CONFIG, ELEMENT], ['ready', card]]);
  cleanup();
  assert.deepEqual(events.at(-1), 'gone');
  assert.deepEqual(cardEvents, ['destroyed']);
});

test('a field that finishes loading after the customer moved on is destroyed, never reported', async () => {
  const mounting = deferred<DepositCard>();
  const events: string[] = [];
  const cleanup = attachDepositCard({ config: CONFIG, element: ELEMENT, mount: () => mounting.promise, onReady: () => events.push('ready'), onFailed: () => events.push('failed'), onGone: () => events.push('gone') });
  cleanup();
  const { card, events: cardEvents } = fakeCard();
  mounting.resolve(card);
  await mounting.promise;
  await Promise.resolve();
  assert.deepEqual(events, ['gone']);
  assert.deepEqual(cardEvents, ['destroyed']);
});

test('a field that cannot load is reported failed (unless the customer already moved on)', async () => {
  for (const cleanUpFirst of [false, true]) {
    const mounting = deferred<DepositCard>();
    const events: string[] = [];
    const cleanup = attachDepositCard({ config: CONFIG, element: ELEMENT, mount: () => mounting.promise, onReady: () => events.push('ready'), onFailed: () => events.push('failed'), onGone: () => events.push('gone') });
    if (cleanUpFirst) cleanup();
    mounting.reject(new Error('script blocked'));
    await mounting.promise.catch(() => undefined);
    await Promise.resolve();
    assert.deepEqual(events, cleanUpFirst ? ['gone'] : ['failed']);
  }
});

// Square never finishes attaching a second card to an element while an earlier
// one is still attaching there and is then destroyed. React's development
// double-mount does exactly that, and the form said "could not be loaded"
// every time (local acceptance run, 15 October 2026).

test('a second field on the same element waits until the first has gone', async () => {
  const element = {} as HTMLElement;
  const first = deferred<DepositCard>();
  const second = deferred<DepositCard>();
  const mounts: string[] = [];
  const events: string[] = [];
  const cleanupFirst = attachDepositCard({ config: CONFIG, element, mount: () => { mounts.push('first'); return first.promise; }, onReady: () => events.push('first ready'), onFailed: () => events.push('first failed'), onGone: () => events.push('first gone') });
  cleanupFirst();
  attachDepositCard({ config: CONFIG, element, mount: () => { mounts.push('second'); return second.promise; }, onReady: () => events.push('second ready'), onFailed: () => events.push('second failed'), onGone: () => events.push('second gone') });
  await flush();
  assert.deepEqual(mounts, ['first'], 'the second waits while the first is still attaching');
  const one = fakeCard();
  first.resolve(one.card);
  await flush();
  assert.deepEqual(one.events, ['destroyed']);
  assert.deepEqual(mounts, ['first', 'second'], 'and starts once the first has gone');
  second.resolve(fakeCard().card);
  await flush();
  assert.deepEqual(events, ['first gone', 'second ready']);
});

test('a field removed by its cleanup is destroyed before the next one on that element starts', async () => {
  const element = {} as HTMLElement;
  const destroying = deferred<void>();
  const mounts: string[] = [];
  const kept: DepositCard = { tokenize: async () => 'cnon:ok', destroy: () => destroying.promise };
  const cleanup = attachDepositCard({ config: CONFIG, element, mount: async () => { mounts.push('first'); return kept; }, onReady: () => undefined, onFailed: () => undefined, onGone: () => undefined });
  await flush();
  cleanup();
  attachDepositCard({ config: CONFIG, element, mount: async () => { mounts.push('second'); return fakeCard().card; }, onReady: () => undefined, onFailed: () => undefined, onGone: () => undefined });
  await flush();
  assert.deepEqual(mounts, ['first'], 'Square is still removing the first field');
  destroying.resolve();
  await flush();
  assert.deepEqual(mounts, ['first', 'second']);
});

test('a field on another element, or after a failed one, starts at once', async () => {
  const mounts: string[] = [];
  const pending = deferred<DepositCard>();
  attachDepositCard({ config: CONFIG, element: {} as HTMLElement, mount: () => { mounts.push('a'); return pending.promise; }, onReady: () => undefined, onFailed: () => undefined, onGone: () => undefined });
  attachDepositCard({ config: CONFIG, element: {} as HTMLElement, mount: () => { mounts.push('b'); return deferred<DepositCard>().promise; }, onReady: () => undefined, onFailed: () => undefined, onGone: () => undefined });
  assert.deepEqual(mounts, ['a', 'b'], 'different elements never wait for each other');
  const element = {} as HTMLElement;
  attachDepositCard({ config: CONFIG, element, mount: () => { mounts.push('failed'); return Promise.reject(new Error('blocked')); }, onReady: () => undefined, onFailed: () => undefined, onGone: () => undefined });
  await flush();
  attachDepositCard({ config: CONFIG, element, mount: () => { mounts.push('retry'); return deferred<DepositCard>().promise; }, onReady: () => undefined, onFailed: () => undefined, onGone: () => undefined });
  assert.deepEqual(mounts.slice(2), ['failed', 'retry']);
});

// --- Time limits (fake timers): a Square step that never answers ------------

/** Let settled promises run their callbacks. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a promise that does not settle in time is refused with a SquareTimeoutError; one that does is passed through', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const never = new Promise<string>(() => undefined);
  const outcome = withTimeout(never, 20_000).then((value) => ({ value }), (error: unknown) => ({ error }));
  t.mock.timers.tick(19_999);
  await flush();
  const settled: unknown[] = [];
  void outcome.then((result) => settled.push(result));
  await flush();
  assert.deepEqual(settled, [], 'still waiting just before the limit');
  t.mock.timers.tick(1);
  const result = await outcome;
  assert.ok('error' in result && result.error instanceof SquareTimeoutError, 'refused at the limit');

  const quick = deferred<string>();
  const passed = withTimeout(quick.promise, 20_000);
  quick.resolve('cnon:ok');
  assert.equal(await passed, 'cnon:ok');
  const failing = deferred<string>();
  const refused = withTimeout(failing.promise, 20_000);
  failing.reject(new Error('Square said no'));
  await assert.rejects(refused, /Square said no/);
});

test('a value that arrives after the limit goes to onLate, never to the caller', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const late = deferred<string>();
  const seen: string[] = [];
  const outcome = withTimeout(late.promise, 1_000, (value) => seen.push(value));
  t.mock.timers.tick(1_000);
  await assert.rejects(outcome, SquareTimeoutError);
  late.resolve('cnon:late');
  await flush();
  assert.deepEqual(seen, ['cnon:late']);
});

test('a card field that has not appeared after 20 seconds is reported failed, and destroyed if it turns up later', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(SQUARE_LOAD_TIMEOUT_MS, 20_000);
  const mounting = deferred<DepositCard>();
  const events: string[] = [];
  attachDepositCard({ config: CONFIG, element: ELEMENT, mount: () => mounting.promise, onReady: () => events.push('ready'), onFailed: () => events.push('failed'), onGone: () => events.push('gone') });
  t.mock.timers.tick(SQUARE_LOAD_TIMEOUT_MS - 1);
  await flush();
  assert.deepEqual(events, [], 'still loading');
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(events, ['failed'], 'the form shows its "could not be loaded" state');
  const { card, events: cardEvents } = fakeCard();
  mounting.resolve(card);
  await flush();
  assert.deepEqual(events, ['failed'], 'a late field is never reported ready');
  assert.deepEqual(cardEvents, ['destroyed'], 'and never left on the page');
});

test('a card field that loads within the limit is ready, and its timer is cleared', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mounting = deferred<DepositCard>();
  const events: string[] = [];
  attachDepositCard({ config: CONFIG, element: ELEMENT, mount: () => mounting.promise, onReady: () => events.push('ready'), onFailed: () => events.push('failed'), onGone: () => events.push('gone') });
  t.mock.timers.tick(5_000);
  mounting.resolve(fakeCard().card);
  await flush();
  t.mock.timers.tick(SQUARE_LOAD_TIMEOUT_MS);
  await flush();
  assert.deepEqual(events, ['ready']);
});

test('a card check may take as long as a bank’s 3-D Secure challenge, but not forever', () => {
  // Card schemes let a challenge run for up to 10 minutes; the page waits a little longer.
  assert.ok(SQUARE_TOKENIZE_TIMEOUT_MS > 10 * 60_000, 'never cuts a real challenge short');
  assert.ok(SQUARE_TOKENIZE_TIMEOUT_MS <= 15 * 60_000, 'a stalled SDK still lets go of the page');
});

// --- A page that is not on screen -------------------------------------------
//
// Square's SDK cannot start in a hidden page: it gives up ("Web Payments SDK
// was unable to be initialized in time") and stays broken until a reload. A
// booking opened in a background tab always said "could not be loaded"
// (local acceptance run, 15 October 2026).

/** A page whose visibility the test switches; `show()` fires the listeners. */
function fakeVisibility(hidden: boolean) {
  const listeners = new Set<() => void>();
  const visibility: PageVisibility = {
    hidden: () => hidden,
    onVisible: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
  };
  return { visibility, listeners, show: () => { hidden = false; for (const listener of [...listeners]) listener(); } };
}

test('a hidden page starts Square only once it is shown', async () => {
  const page = fakeVisibility(true);
  const mounting = deferred<DepositCard>();
  const events: string[] = [];
  attachDepositCard({ config: CONFIG, element: {} as HTMLElement, visibility: page.visibility, mount: () => { events.push('mount'); return mounting.promise; }, onReady: () => events.push('ready'), onFailed: () => events.push('failed'), onGone: () => events.push('gone') });
  await flush();
  assert.deepEqual(events, [], 'Square is not touched while the page is hidden');
  page.show();
  assert.deepEqual(events, ['mount']);
  assert.equal(page.listeners.size, 0, 'it stops listening once started');
  mounting.resolve(fakeCard().card);
  await flush();
  assert.deepEqual(events, ['mount', 'ready']);
});

test('the 20-second limit counts from when the page is shown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = fakeVisibility(true);
  const events: string[] = [];
  attachDepositCard({ config: CONFIG, element: {} as HTMLElement, visibility: page.visibility, mount: () => deferred<DepositCard>().promise, onReady: () => events.push('ready'), onFailed: () => events.push('failed'), onGone: () => events.push('gone') });
  t.mock.timers.tick(10 * 60_000);
  await flush();
  assert.deepEqual(events, [], 'a page left in the background never fails');
  page.show();
  t.mock.timers.tick(SQUARE_LOAD_TIMEOUT_MS - 1);
  await flush();
  assert.deepEqual(events, []);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(events, ['failed']);
});

test('a field removed while it waits for the page never starts, and frees its element', async () => {
  const page = fakeVisibility(true);
  const element = {} as HTMLElement;
  const events: string[] = [];
  const cleanup = attachDepositCard({ config: CONFIG, element, visibility: page.visibility, mount: () => { events.push('first mount'); return deferred<DepositCard>().promise; }, onReady: () => undefined, onFailed: () => undefined, onGone: () => events.push('gone') });
  cleanup();
  assert.equal(page.listeners.size, 0, 'no listener left behind');
  const shown = fakeVisibility(false);
  attachDepositCard({ config: CONFIG, element, visibility: shown.visibility, mount: () => { events.push('second mount'); return deferred<DepositCard>().promise; }, onReady: () => undefined, onFailed: () => undefined, onGone: () => undefined });
  await flush();
  assert.deepEqual(events, ['gone', 'second mount']);
});
