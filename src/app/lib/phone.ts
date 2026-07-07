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
