// Shared by the server session layer and optimistic middleware. Never extend a
// token on navigation: revoked claims must not acquire a new issuance time.
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
export const CUSTOMER_SESSION_SECONDS = 30 * 24 * 60 * 60;
export const KIOSK_SESSION_SECONDS = 30 * 24 * 60 * 60;

export function sessionLifetimeSeconds(role: string): number {
  return role === 'ADMIN' ? ADMIN_SESSION_SECONDS : CUSTOMER_SESSION_SECONDS;
}

export function isWithinSessionLifetime(role: unknown, issuedAt: unknown): boolean {
  if ((role !== 'ADMIN' && role !== 'USER') || typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) return false;
  const now = Math.floor(Date.now() / 1000);
  return issuedAt <= now && now < issuedAt + sessionLifetimeSeconds(role);
}
