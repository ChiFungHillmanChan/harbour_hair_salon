// Pure: which recipients a Vercel PREVIEW deployment may email
// (email-service.ts sendPreparedEmail, every email path). A preview runs on a
// copy of the production database — real customers' addresses — so anything
// it sends (reminders, review requests, a queued backlog, a test someone runs)
// must reach only the tester. Production and local development are unaffected.

/** The allow-list: full addresses, and `@domain` entries matching every address at that domain. */
export type PreviewEmailAllowlist = { addresses: ReadonlySet<string>; domains: ReadonlySet<string> };

/**
 * PREVIEW_EMAIL_ALLOWLIST, e.g. `tester@example.com, @example.org`: comma-
 * separated, case-insensitive. Entries that are neither an address nor an
 * `@domain` are ignored.
 */
export function parsePreviewEmailAllowlist(value: string | undefined): PreviewEmailAllowlist {
  const addresses = new Set<string>();
  const domains = new Set<string>();
  for (const raw of (value ?? '').split(',')) {
    const entry = raw.trim().toLowerCase();
    if (/^@[^\s@]+\.[^\s@]+$/.test(entry)) domains.add(entry.slice(1));
    else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)) addresses.add(entry);
  }
  return { addresses, domains };
}

/** The bare, lower-cased address of a recipient written `addr` or `Name <addr>`. */
function bareAddress(recipient: string): string {
  const text = recipient.trim();
  return (text.match(/<([^<>]+)>\s*$/)?.[1] ?? text).trim().toLowerCase();
}

export function isPreviewRecipientAllowed(recipient: string, allowlist: PreviewEmailAllowlist): boolean {
  const address = bareAddress(recipient);
  const at = address.lastIndexOf('@');
  if (at <= 0) return false;
  return allowlist.addresses.has(address) || allowlist.domains.has(address.slice(at + 1));
}

/**
 * True when this email must NOT be sent: the deployment is a Vercel preview
 * (`VERCEL_ENV === 'preview'`) and a recipient is missing from
 * PREVIEW_EMAIL_ALLOWLIST. With the variable unset, a preview sends nothing.
 * `env` is read by the caller at send time, never at module load.
 */
export function isPreviewEmailBlocked(to: string | readonly string[], env: { VERCEL_ENV?: string; PREVIEW_EMAIL_ALLOWLIST?: string }): boolean {
  if (env.VERCEL_ENV !== 'preview') return false;
  const allowlist = parsePreviewEmailAllowlist(env.PREVIEW_EMAIL_ALLOWLIST);
  const recipients = (typeof to === 'string' ? to.split(',') : [...to]).filter((recipient) => recipient.trim() !== '');
  return recipients.length === 0 || !recipients.every((recipient) => isPreviewRecipientAllowed(recipient, allowlist));
}
