// Cosmetic auth hint shared between the server (which sets/clears the cookie
// alongside the real httpOnly session) and the header (which reads it from
// document.cookie). Deliberately NOT httpOnly: it carries only the role so the
// static, ISR-cached header can show the right account links without a network
// round-trip. Every protected route still verifies the real session server-side.
export const SESSION_HINT_COOKIE = 'session_hint';

/** Parse a document.cookie string; returns the role or null when signed out. */
export function parseSessionHint(cookieString: string): string | null {
  for (const pair of cookieString.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name !== SESSION_HINT_COOKIE) continue;
    const value = decodeURIComponent(rest.join('='));
    return value || null;
  }
  return null;
}
