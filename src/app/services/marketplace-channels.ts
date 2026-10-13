// Which third-party booking marketplaces the site ADVERTISES, derived from the
// URLs the salon has filled in under Admin -> Site Settings. Pure and
// dependency-free so its callers share one definition:
//
//   - /book renders a CTA per advertised marketplace while booking is closed
//   - the home page's booking quick links do the same
//
// Display only. It says nothing about double-booking safety: the online-booking
// readiness gate (integration-readiness.ts) checks each stylist's calendar
// connections with receivesBookings = true, and ignores these URLs. Clearing a
// URL here hides the button; it does not stop that marketplace selling slots —
// a channel that still takes bookings must keep (or gain) a working feed.

export type MarketplaceLink = { name: string; url: string };

export type MarketplaceSettings = {
  treatwellUrl: string;
  freshaUrl: string;
  booksyUrl: string;
};

/** Fresha first: it is the channel the salon is moving to. */
const CHANNELS: { name: string; key: keyof MarketplaceSettings }[] = [
  { name: 'Fresha', key: 'freshaUrl' },
  { name: 'Treatwell', key: 'treatwellUrl' },
  { name: 'Booksy', key: 'booksyUrl' },
];

export function activeMarketplaces(settings: MarketplaceSettings): MarketplaceLink[] {
  return CHANNELS.flatMap(({ name, key }) => {
    const url = (settings[key] ?? '').trim();
    return url ? [{ name, url }] : [];
  });
}
