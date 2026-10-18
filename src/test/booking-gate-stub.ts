/**
 * A stub of lib/booking-maintenance.ts for tests written before beta booking
 * (owner decision 2026-10-18): it answers the beta-aware gate exactly as the
 * public one, and nobody is on the beta list. `assertOnlineBookingReadyFor`
 * hands the stub's own `assertOnlineBookingReady` the same client, so a test
 * that checks the transaction client still checks it.
 */
export function publicGateStub<T extends {
  isBookingEnabled?: () => Promise<boolean>;
  assertOnlineBookingReady?: (db: never) => Promise<unknown>;
}>(stub: T) {
  return {
    ...stub,
    isBetaBookingOpenFor: async () => false,
    isBookingEnabledFor: async () => (stub.isBookingEnabled ? stub.isBookingEnabled() : false),
    assertOnlineBookingReadyFor: async (db: never) => {
      if (!stub.assertOnlineBookingReady) throw new Error('assertOnlineBookingReady is not stubbed');
      return stub.assertOnlineBookingReady(db);
    },
  };
}
