import { z } from 'zod';

/**
 * The address in a mailbox setting such as EMAIL_FROM or EMAIL_REPLY_TO: a bare
 * "addr@example.com" or, with `allowName`, "Name <addr@example.com>". Trimmed
 * and lower-cased; null when the value is not exactly one valid address.
 */
export function mailboxAddress(value: string | null | undefined, allowName = false): string | null {
  const text = value?.trim() ?? '';
  const address = allowName && text.includes('<') ? text.match(/^[^<>\r\n]*<([^<>]+)>$/)?.[1] : text;
  return address && z.email().safeParse(address).success ? address.toLowerCase() : null;
}
