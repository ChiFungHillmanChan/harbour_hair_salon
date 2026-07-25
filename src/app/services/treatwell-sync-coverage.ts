// Pure evaluation of whether the Treatwell two-way calendar sync is actually
// switched on. Dependency-free so it can be unit-tested directly.
//
// Why this exists: the sync code was fully implemented and shipped, but in
// production NO stylist had `treatwellIcalUrl` (inbound) or `icalToken`
// (outbound) set, and ExternalBusyBlock was empty. That is harmless only while
// online booking is disabled — the moment Settings → Online booking is switched on,
// the site and Treatwell would be selling the same slots with nothing
// reconciling them. This turns that silent state into a visible warning.

export type SyncCoverageInput = {
  /** Total stylists who can take bookings. */
  totalStylists: number;
  /** Stylists with a Treatwell iCal URL configured (Treatwell → site). */
  inboundConfigured: number;
  /** Stylists with an outbound busy-feed token generated (site → Treatwell). */
  outboundConfigured: number;
};

export type SyncCoverage = {
  inboundReady: boolean;
  outboundReady: boolean;
  missingInbound: number;
  missingOutbound: number;
  /**
   * True only when BOTH directions cover every stylist. Anything less means
   * re-enabling online booking risks double-booking against Treatwell.
   */
  safeToEnableOnlineBooking: boolean;
  /** Operator-facing summary, or null when everything is covered. */
  warning: string | null;
};

export function evaluateSyncCoverage(input: SyncCoverageInput): SyncCoverage {
  const { totalStylists, inboundConfigured, outboundConfigured } = input;

  const missingInbound = Math.max(0, totalStylists - inboundConfigured);
  const missingOutbound = Math.max(0, totalStylists - outboundConfigured);

  // With no stylists at all there is nothing to reconcile, but there is also
  // nothing bookable — treat it as not ready rather than silently "safe".
  const inboundReady = totalStylists > 0 && missingInbound === 0;
  const outboundReady = totalStylists > 0 && missingOutbound === 0;
  const safeToEnableOnlineBooking = inboundReady && outboundReady;

  if (safeToEnableOnlineBooking) {
    return { inboundReady, outboundReady, missingInbound, missingOutbound, safeToEnableOnlineBooking, warning: null };
  }

  const parts: string[] = [];
  if (totalStylists === 0) {
    parts.push('no stylists are set up yet');
  } else {
    if (missingInbound > 0) {
      parts.push(
        `${missingInbound} of ${totalStylists} stylist(s) have no Treatwell iCal URL, so Treatwell bookings will NOT block slots on this site`,
      );
    }
    if (missingOutbound > 0) {
      parts.push(
        `${missingOutbound} of ${totalStylists} stylist(s) have no outbound busy-feed token, so bookings made here will NOT block slots on Treatwell`,
      );
    }
  }

  return {
    inboundReady,
    outboundReady,
    missingInbound,
    missingOutbound,
    safeToEnableOnlineBooking,
    warning: `Double-booking risk: ${parts.join('; ')}.`,
  };
}
