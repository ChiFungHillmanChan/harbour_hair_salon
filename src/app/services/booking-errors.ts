import type { Locale } from '@/i18n/config';
import type { MessageParams } from '@/i18n/format';
import { translator } from '@/i18n/messages';
import type englishErrors from '@/i18n/messages/en/errors';

/** Stable codes for every customer/admin-safe booking message (see messages/errors.ts). */
export type BookingErrorCode = keyof (typeof englishErrors)['booking'];

/** The message for a code in a language. Used at the action boundary. */
export function bookingErrorText(locale: Locale, code: BookingErrorCode, params?: MessageParams): string {
  return translator(locale, 'errors').dynamic(`booking.${code}`, params);
}

/**
 * Errors whose message is SAFE to show the customer. The booking actions
 * return `instanceof BookingError` messages — translated from `code` into the
 * caller's language — and replace anything else with a generic message, so
 * internal/Prisma errors never leak to the client. `message` stays English for
 * logs and for callers that do not know a language.
 */
export class BookingError extends Error {
  readonly code: BookingErrorCode;
  readonly params?: MessageParams;

  constructor(code: BookingErrorCode, params?: MessageParams) {
    super(bookingErrorText('en-GB', code, params));
    this.name = 'BookingError';
    this.code = code;
    this.params = params;
  }

  /** This error in the caller's language. */
  localized(locale: Locale): string {
    return bookingErrorText(locale, this.code, this.params);
  }
}

/** A slot/stylist that was free at fetch time is no longer bookable. */
export class SlotUnavailableError extends BookingError {
  constructor(code: 'SLOT_UNAVAILABLE' | 'NO_STYLIST_AT_TIME' = 'SLOT_UNAVAILABLE') {
    super(code);
    this.name = 'SlotUnavailableError';
  }
}

/** A discount code could not be claimed (invalid, expired, or fully used). */
export class DiscountUnavailableError extends BookingError {
  constructor(code: 'DISCOUNT_UNAVAILABLE' | 'DISCOUNTS_PAUSED' = 'DISCOUNT_UNAVAILABLE') {
    super(code);
    this.name = 'DiscountUnavailableError';
  }
}

/** Translate a caught error for the customer, falling back to a generic code. */
export function describeBookingError(error: unknown, locale: Locale, fallback: BookingErrorCode): string {
  return error instanceof BookingError ? error.localized(locale) : bookingErrorText(locale, fallback);
}
