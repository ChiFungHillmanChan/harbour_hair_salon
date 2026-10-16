// What an imported busy block is, read from its provider's generic title.
// Fresha's export feed titles every event "Fresha Appointment" or "Fresha
// Blocked Time" (a stylist's lunch, holiday or block) and never carries a
// customer's details, so those two titles are safe to keep. Any other title is
// free text — a Google calendar can hold a customer's name — so it is never
// stored: the block stays a plain busy time from its provider.

export type BusyKind = 'blocked' | 'booking';

const KNOWN_TITLES: Record<string, { title: string; kind: BusyKind }> = {
  'fresha blocked time': { title: 'Fresha Blocked Time', kind: 'blocked' },
  'fresha appointment': { title: 'Fresha Appointment', kind: 'booking' },
};

const known = (title: string | null | undefined) =>
  title ? KNOWN_TITLES[title.trim().replace(/\s+/g, ' ').toLowerCase()] : undefined;

/** What ExternalBusyBlock.summary may hold: a recognised generic title, canonical spelling; otherwise null. */
export function storedBusySummary(title: string | null | undefined): string | null {
  return known(title)?.title ?? null;
}

/** A stored summary's kind; null when the provider did not say (shown as a plain busy time). */
export function busyKindOf(summary: string | null | undefined): BusyKind | null {
  return known(summary)?.kind ?? null;
}
