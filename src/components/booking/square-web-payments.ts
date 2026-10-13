import { poundsFromPence } from '@/app/services/deposit-policy';

// The booking page's only contact with Square's Web Payments SDK
// (docs/superpowers/specs/2026-10-13-square-deposits-design.md). Card numbers
// are typed into Square's own iframe; this page only ever sees the single-use
// token that comes back, and the server authorizes the deposit with it. Kept
// apart from React and behind an injectable host, so tests can fake the SDK.

/** The only Square values the browser receives: none of them is secret. */
export type SquarePublicConfig = {
  applicationId: string;
  locationId: string;
  environment: 'sandbox' | 'production';
};

/** Who pays, from the signed-in account: Square asks for it to verify the card (3-D Secure). */
export type DepositPayer = { name: string | null; email: string | null };

/** Square's verification details for `card.tokenize` (Strong Customer Authentication). */
export type VerificationDetails = {
  amount: string;
  currencyCode: 'GBP';
  intent: 'CHARGE';
  customerInitiated: true;
  sellerKeyedIn: false;
  billingContact: { givenName?: string; familyName?: string; email?: string; countryCode: 'GB' };
};

type TokenResult = { status: string; token?: string };
type SquareCard = {
  attach(target: HTMLElement | string): Promise<void>;
  tokenize(details: VerificationDetails): Promise<TokenResult>;
  destroy(): Promise<unknown> | unknown;
};
type SquarePayments = { card(options?: { style?: Record<string, Record<string, string>> }): Promise<SquareCard> };
/** `window.Square` once the SDK script has loaded. */
export type SquareSdk = { payments(applicationId: string, locationId: string): SquarePayments | Promise<SquarePayments> };

/** Square's script for each environment; the CSP allows exactly these hosts (next.config.ts). */
export const SQUARE_SDK_URLS: Record<SquarePublicConfig['environment'], string> = {
  sandbox: 'https://sandbox.web.squarecdn.com/v1/square.js',
  production: 'https://web.squarecdn.com/v1/square.js',
};

/** Where the script is loaded: the real page, or a fake one in tests. */
export type SdkHost = { document: Document; window: { Square?: SquareSdk } };

/**
 * How long the card field may take to appear (script, SDK start-up and
 * attaching Square's iframe) before the form shows its "could not be loaded"
 * state instead of loading forever.
 */
export const SQUARE_LOAD_TIMEOUT_MS = 20_000;

/**
 * How long one `tokenize` may take before the booking page gives up on it,
 * so a stalled SDK can never leave "Checking your card…" (and the submit
 * lock) on screen for good. Deliberately not 20 seconds: with Strong Customer
 * Authentication, tokenize includes the bank's 3-D Secure challenge, which the
 * customer completes in their own time (a code by text message, an approval
 * in their banking app) and which card schemes let run for up to 10 minutes.
 * Cutting it short would refuse every customer who takes longer than that.
 */
export const SQUARE_TOKENIZE_TIMEOUT_MS = 11 * 60_000;

/** A Square step that never answered within its time limit. */
export class SquareTimeoutError extends Error {
  constructor() {
    super('Square did not answer in time');
    this.name = 'SquareTimeoutError';
  }
}

/**
 * `promise`, or a SquareTimeoutError after `ms`. A value that arrives after
 * the time limit is handed to `onLate` (e.g. to destroy a card field nobody
 * will use); a late failure is ignored.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, onLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new SquareTimeoutError());
    }, ms);
    promise.then(
      (value) => {
        if (timedOut) {
          onLate?.(value);
          return;
        }
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (timedOut) return;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const loads = new WeakMap<object, Map<string, Promise<SquareSdk>>>();

/**
 * Load Square's script once per page and environment. A failed load is
 * forgotten, so showing the card form again tries again.
 */
export function loadSquareSdk(environment: SquarePublicConfig['environment'], host: SdkHost = { document, window: window as SdkHost['window'] }): Promise<SquareSdk> {
  if (host.window.Square) return Promise.resolve(host.window.Square);
  const src = SQUARE_SDK_URLS[environment];
  const pending = loads.get(host.document) ?? new Map<string, Promise<SquareSdk>>();
  loads.set(host.document, pending);
  const existing = pending.get(src);
  if (existing) return existing;
  const loading = new Promise<SquareSdk>((resolve, reject) => {
    const script = host.document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => (host.window.Square ? resolve(host.window.Square) : reject(new Error('The Square payment form did not start')));
    script.onerror = () => reject(new Error('The Square payment form could not be loaded'));
    host.document.head.appendChild(script);
  });
  pending.set(src, loading);
  loading.catch(() => pending.delete(src));
  return loading;
}

/**
 * The card field in the salon's black/white/grey (the SDK's own focus colour
 * is blue). Only selectors and properties Square documents for card styling.
 */
const CARD_STYLE = {
  '.input-container': { borderColor: '#d4d4d8', borderRadius: '8px' },
  '.input-container.is-focus': { borderColor: '#18181b' },
  '.message-text': { color: '#52525b' },
  '.message-icon': { color: '#52525b' },
  'input::placeholder': { color: '#71717a' },
};

/** A mounted card field: tokenize returns the token, or null when Square did not accept the card details. */
export type DepositCard = {
  tokenize(details: VerificationDetails): Promise<string | null>;
  destroy(): Promise<void>;
};

export async function mountSquareCard(
  config: SquarePublicConfig,
  container: HTMLElement,
  load: (environment: SquarePublicConfig['environment']) => Promise<SquareSdk> = loadSquareSdk,
): Promise<DepositCard> {
  const square = await load(config.environment);
  const payments = await square.payments(config.applicationId, config.locationId);
  let card: SquareCard;
  try {
    card = await payments.card({ style: CARD_STYLE });
  } catch {
    // A style the SDK refuses must not cost the customer the card form.
    card = await payments.card();
  }
  await card.attach(container);
  return {
    async tokenize(details) {
      const result = await card.tokenize(details);
      return result.status === 'OK' && typeof result.token === 'string' && result.token.length > 0 ? result.token : null;
    },
    async destroy() {
      try {
        await card.destroy();
      } catch {
        // Already gone.
      }
    },
  };
}

/**
 * The card field's life on the page, apart from React: mount it into
 * `element`, report it ready (or failed), and return the cleanup that removes
 * it. A field that finishes loading after the cleanup (the customer moved on,
 * or React's development double-mount) is destroyed at once, so there is
 * never a second card field on the page. A field that has not appeared within
 * `timeoutMs` (SQUARE_LOAD_TIMEOUT_MS) is reported failed, and destroyed if
 * it turns up later.
 */
export function attachDepositCard(options: {
  config: SquarePublicConfig;
  element: HTMLElement;
  mount: (config: SquarePublicConfig, container: HTMLElement) => Promise<DepositCard>;
  onReady: (card: DepositCard) => void;
  onFailed: () => void;
  /** The field is gone (cleanup): it can no longer tokenize. */
  onGone: () => void;
  timeoutMs?: number;
}): () => void {
  let active = true;
  let card: DepositCard | null = null;
  withTimeout(options.mount(options.config, options.element), options.timeoutMs ?? SQUARE_LOAD_TIMEOUT_MS, (late) => { void late.destroy(); }).then(
    (mounted) => {
      if (!active) {
        void mounted.destroy();
        return;
      }
      card = mounted;
      options.onReady(mounted);
    },
    () => {
      if (active) options.onFailed();
    },
  );
  return () => {
    active = false;
    options.onGone();
    void card?.destroy();
  };
}

/** "Mary Ann Smith" → given "Mary Ann", family "Smith"; a single word is the given name. */
function splitName(name: string | null): { givenName?: string; familyName?: string } {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length === 0) return {};
  if (words.length === 1) return { givenName: words[0] };
  return { givenName: words.slice(0, -1).join(' '), familyName: words[words.length - 1] };
}

/**
 * What Square verifies the card against: the exact deposit the server quoted
 * (shown to the customer in any 3-D Secure challenge), a customer-initiated
 * charge in GBP, and the account holder's name and email.
 */
export function depositVerificationDetails(depositPence: number, payer: DepositPayer): VerificationDetails {
  const email = payer.email?.trim();
  return {
    amount: poundsFromPence(depositPence),
    currencyCode: 'GBP',
    intent: 'CHARGE',
    customerInitiated: true,
    sellerKeyedIn: false,
    billingContact: { ...splitName(payer.name), ...(email ? { email } : {}), countryCode: 'GB' },
  };
}
