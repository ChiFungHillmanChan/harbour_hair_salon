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
  /**
   * Marketplaces currently advertised on the site, by name — the ones that can
   * actually sell the same chairs. Empty means this site is the only channel,
   * so there is nothing to reconcile and no risk to warn about.
   */
  activeMarketplaces: string[];
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
  const { totalStylists, inboundConfigured, outboundConfigured, activeMarketplaces } = input;

  const missingInbound = Math.max(0, totalStylists - inboundConfigured);
  const missingOutbound = Math.max(0, totalStylists - outboundConfigured);
  const inboundReady = totalStylists > 0 && missingInbound === 0;
  const outboundReady = totalStylists > 0 && missingOutbound === 0;
  const counts = { inboundReady, outboundReady, missingInbound, missingOutbound };

  // Nothing is bookable at all — a different problem, but still not "ready".
  if (totalStylists === 0) {
    return {
      ...counts,
      inboundReady: false,
      outboundReady: false,
      safeToEnableOnlineBooking: false,
      warning: 'Double-booking risk: no stylists are set up yet.',
    };
  }

  // No marketplace is selling these chairs, so this site is the only place a
  // slot can be taken and calendar sync is not needed. Without this the banner
  // fires permanently once Treatwell is switched off, and a warning that is
  // always on is a warning nobody reads.
  if (activeMarketplaces.length === 0) {
    return { ...counts, safeToEnableOnlineBooking: true, warning: null };
  }

  const parts: string[] = [];

  if (activeMarketplaces.includes('Treatwell')) {
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

  // Treatwell is the only channel with a sync implementation. Any other live
  // marketplace has no path in either direction, so being fully configured for
  // Treatwell proves nothing about it.
  for (const name of activeMarketplaces.filter((m) => m !== 'Treatwell')) {
    parts.push(
      `${name} is listed on the site but has no calendar sync in either direction, so ${name} bookings and bookings made here will not block each other`,
    );
  }

  if (parts.length === 0) {
    return { ...counts, safeToEnableOnlineBooking: true, warning: null };
  }

  return {
    ...counts,
    safeToEnableOnlineBooking: false,
    warning: `Double-booking risk: ${parts.join('; ')}.`,
  };
}
