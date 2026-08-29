// Which third-party booking marketplaces are live, derived from the URLs the
// salon has filled in under Admin -> Site Settings. Pure and dependency-free so
// both callers can share one definition:
//
//   - /book renders a CTA per active marketplace while booking is closed
//   - the readiness gate treats "no active marketplace" as nothing to reconcile
//
// Deriving this from the URLs (rather than a separate flag) means clearing
// Treatwell's URL in the admin panel both removes the dead button AND clears
// the double-booking warning — one lever, no deploy, no migration.

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
