// Pure phone-number helpers. No Prisma/server imports so this can be used
// from server components, client components, and unit tests alike.

/**
 * Builds a `tel:` URI from an admin-editable phone number (as stored in
 * `SiteSettings.phone`, e.g. "07831 830898").
 *
 * - Spaces are stripped.
 * - If the number already starts with `+` it's assumed to be in
 *   international (E.164) form already and is used as-is.
 * - Otherwise a leading UK trunk `0` is replaced with `+44`.
 */
export function toTelHref(phone: string): string {
  const stripped = phone.replace(/\s+/g, '');
  if (stripped.startsWith('+')) return `tel:${stripped}`;
  if (stripped.startsWith('0')) return `tel:+44${stripped.slice(1)}`;
  return `tel:${stripped}`;
}

/**
 * The phone number a customer gives so the salon can reach them about a
 * booking. Online booking needs one (owner request 2026-11-15): the salon's
 * new-request email and the Google diary show it to staff. Pure, so the
 * booking page checks it as the customer types and submitBooking decides by
 * the same rule.
 */

/** Matches the register form's limit (actions/auth.ts PHONE_TOO_LONG). */
export const CONTACT_PHONE_MAX_LENGTH = 20;
/** UK numbers have 10 or 11 digits; this leaves room for short and international ones. */
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;
/** Digits, a leading-or-inner +, spaces, brackets, dots and dashes: what people write. */
const ALLOWED = /^[0-9+()\-. ]+$/;

/**
 * The number as it will be saved (trimmed, inner spaces collapsed), or null
 * when it is missing or does not look like a phone number.
 */
export function normalizeContactPhone(raw: string | null | undefined): string | null {
  const phone = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!phone || phone.length > CONTACT_PHONE_MAX_LENGTH || !ALLOWED.test(phone)) return null;
  const digits = phone.replace(/\D/g, '').length;
  return digits >= MIN_DIGITS && digits <= MAX_DIGITS ? phone : null;
}
