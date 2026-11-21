// What the booking page tells the server when the card step fails in the
// browser. Square checks the card (and runs the bank's 3-D Secure) inside the
// page, so a refusal there never reaches submitBooking: before these reports
// a customer could fail twice and leave nothing in any log (customer report
// 2026-11-19). Shared by the page (which builds a report) and the server
// action (which accepts it again, actions/card-check.ts): no imports, no I/O.
//
// A report holds Square's status and error categories, an error's class and a
// short scrubbed message, a blocked frame's origin — never card data, which
// only ever exists inside Square's own frames.

export const CARD_CHECK_FAILURE_KINDS = [
  /** The card field never appeared (script, SDK start-up or attach failed or timed out). */
  'CARD_FORM_FAILED',
  /** The customer confirmed before the card field was ready. */
  'CARD_NOT_READY',
  /** Square answered tokenize without a token (invalid details, 3-D Secure failed or was cancelled). */
  'TOKENIZE_REFUSED',
  /** Square's tokenize threw. */
  'TOKENIZE_THREW',
  /** Square's tokenize never answered within SQUARE_TOKENIZE_TIMEOUT_MS. */
  'TOKENIZE_TIMEOUT',
  /** The card was accepted but sending the request to the server failed (network, server fault). */
  'SUBMIT_FAILED',
  /** The browser blocked something under the page's Content-Security-Policy while the card form was shown. */
  'CSP_BLOCKED',
] as const;

export type CardCheckFailureKind = (typeof CARD_CHECK_FAILURE_KINDS)[number];

export type CardCheckFailure = {
  kind: CardCheckFailureKind;
  /** Square's TokenResult status (e.g. Invalid, Error, Cancel, Abort, Unknown). */
  status?: string;
  /** Square's error types (e.g. VALIDATION_ERROR), comma-separated. */
  errorTypes?: string;
  /** The card fields Square complained about, comma-separated. */
  fields?: string;
  /** A thrown error's class (e.g. VerifyBuyerError, SquareTimeoutError). */
  errorKind?: string;
  /** A short, scrubbed message. */
  detail?: string;
  /** CSP_BLOCKED: the directive that blocked, and the blocked origin (never a path). */
  directive?: string;
  blockedOrigin?: string;
};

/** Upper bounds the server enforces as well. */
export const CARD_CHECK_LIMITS = { short: 64, list: 200, detail: 200 } as const;

/**
 * Free text made safe to log: control characters removed, every run of four
 * or more digits (a card number, a code, a phone number) masked, length capped.
 */
export function scrubCardCheckText(text: unknown, max: number = CARD_CHECK_LIMITS.detail): string | undefined {
  if (typeof text !== 'string') return undefined;
  const cleaned = text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\d(?:[\s-]?\d){3,}/g, '#').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

type SquareTokenError = { type?: unknown; field?: unknown; message?: unknown };

/** A tokenize answer that carried no token, as a report. */
export function tokenizeRefusalReport(result: { status?: unknown; errors?: unknown }): CardCheckFailure {
  const errors = Array.isArray(result.errors) ? (result.errors as SquareTokenError[]) : [];
  const list = (values: unknown[]) => scrubCardCheckText([...new Set(values.filter((value): value is string => typeof value === 'string' && value !== ''))].join(','), CARD_CHECK_LIMITS.list);
  return {
    kind: 'TOKENIZE_REFUSED',
    status: scrubCardCheckText(result.status, CARD_CHECK_LIMITS.short) ?? 'none',
    errorTypes: list(errors.map((error) => error?.type)),
    fields: list(errors.map((error) => error?.field)),
    detail: scrubCardCheckText(errors.map((error) => error?.message).filter((message) => typeof message === 'string').join(' | ')),
  };
}

/** Something thrown during the card step, as a report of `kind`. */
export function thrownReport(kind: CardCheckFailureKind, error: unknown): CardCheckFailure {
  const named = error instanceof Error ? error : null;
  return {
    kind,
    errorKind: scrubCardCheckText(named?.name ?? typeof error, CARD_CHECK_LIMITS.short),
    detail: scrubCardCheckText(named ? named.message : typeof error === 'string' ? error : undefined),
  };
}

/** A `securitypolicyviolation` event as a report: the origin only, never the path or query. */
export function cspViolationReport(event: { effectiveDirective?: string; violatedDirective?: string; blockedURI?: string }): CardCheckFailure {
  let blockedOrigin: string;
  try {
    blockedOrigin = new URL(event.blockedURI ?? '').origin;
    if (blockedOrigin === 'null') blockedOrigin = new URL(event.blockedURI ?? '').protocol;
  } catch {
    // 'inline', 'eval', 'data', … are keywords, not URLs.
    blockedOrigin = event.blockedURI ?? '';
  }
  return {
    kind: 'CSP_BLOCKED',
    directive: scrubCardCheckText(event.effectiveDirective || event.violatedDirective, CARD_CHECK_LIMITS.short),
    blockedOrigin: scrubCardCheckText(blockedOrigin, CARD_CHECK_LIMITS.list) ?? 'unknown',
  };
}
