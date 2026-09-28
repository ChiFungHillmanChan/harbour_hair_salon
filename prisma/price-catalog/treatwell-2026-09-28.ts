/**
 * Treatwell-aligned price list — the single reviewable source for the
 * 2026-09-28 price update. `apply-price-catalog.ts` turns it into database
 * changes (dry run by default); seed.ts builds local/test databases from it.
 *
 * Provenance: the figures were read on 2026-09-28 from the owner's logged-in
 * Treatwell Connect menu (read-only) and recorded in
 * docs/superpowers/specs/2026-09-28-treatwell-pricing-bilingual-design.md.
 * They were NOT re-read when this file was written. Where Treatwell and Fresha
 * differ, Treatwell wins (e.g. long-hair wash/cut/blow-dry NHS: Treatwell £45,
 * Fresha once showed £44 — £45 is used; the two are never averaged).
 *
 * `legacyNames` is the ONE-TIME manual mapping from existing rows to these
 * options, by exact name, reviewed against the production inventory of
 * 2026-09-28. After the first apply, rows are matched by their explicit
 * (offeringId, hairLength, priceType) link — never by name again, and pricing
 * code never reads names at all.
 */
import type { HairLength, PriceNature, PriceType } from '../../src/app/services/pricing/policy';

export const CATALOG_ID = 'treatwell-2026-09-28';
export const VERIFIED_AT = '2026-09-28';
export const PRICE_SOURCE = `treatwell:${VERIFIED_AT}`;

/**
 * Why a row shows "VAT excluded".
 * - TREATWELL_LABEL: the Treatwell item/option name carries "VAT excluded".
 * - OWNER_POLICY_COMPOSITE: the owner's display instruction for a combined
 *   price. The £37 "Adds Extra Long" line was seen on Treatwell but its own VAT
 *   label was NOT verified — kept distinct so nobody later reads this as a
 *   platform fact about the add-on.
 */
export type VatEvidence = 'TREATWELL_LABEL' | 'OWNER_POLICY_COMPOSITE';

export type CatalogOption = {
  hairLength: HairLength | null;
  priceType: PriceType;
  pricePence: number;
  vatEvidence: VatEvidence;
  priceNature: PriceNature;
  /** Existing row names this option replaces (one-time mapping; exact match). */
  legacyNames: string[];
  /** Only for options that may not exist yet: how to create the row. */
  create?: {
    name: string;
    description: string;
    /** Placeholder minutes copied from the nearest existing option — NOT a confirmed duration. */
    placeholderDurationFrom: { hairLength: HairLength | null; priceType: PriceType };
  };
  /**
   * £37 "Adds Extra Long" on Treatwell's full-head colour: the owner confirmed
   * extra long = long-hair price + £37 (£157 + £37 = £194, NHS £142 + £37 = £179).
   * These totals are the owner's combination, not two options seen on Treatwell.
   */
  surcharge?: { baseHairLength: HairLength; amountPence: number; label: 'Adds Extra Long' };
};

export type CatalogOffering = {
  key: string;
  category: 'Haircuts' | 'Colouring' | 'Perms' | 'Treatments' | 'Styling';
  name: string;
  displayOrder: number;
  /** Shared by every option row that mirrors this offering. */
  flags: { requiresPatchTest: boolean; requiresConsultation: boolean };
  /** English fine print shown beside the price (Chinese in content-translations). */
  priceNote?: string;
  options: CatalogOption[];
};

const T: VatEvidence = 'TREATWELL_LABEL';
const cut = { requiresPatchTest: false, requiresConsultation: false };
const colour = { requiresPatchTest: true, requiresConsultation: true };
const byConsultation = { requiresPatchTest: false, requiresConsultation: true };

export const OFFERINGS: CatalogOffering[] = [
  {
    key: 'wash-cut-blow-dry', category: 'Haircuts', name: 'Wash, Haircut & Blow Dry', displayOrder: 10, flags: cut,
    options: [
      { hairLength: 'SHORT', priceType: 'STANDARD', pricePence: 3700, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Short Over Ears - Wash, Haircut & Blow Dry'] },
      { hairLength: 'SHORT', priceType: 'NHS', pricePence: 3300, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Short Over Ears - Wash, Haircut & Blow Dry (Student & NHS)'] },
      { hairLength: 'LONG', priceType: 'STANDARD', pricePence: 4900, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Long Hair - Wash, Haircut & Blow Dry'] },
      { hairLength: 'LONG', priceType: 'NHS', pricePence: 4500, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Long Hair - Wash, Haircut & Blow Dry (Student & NHS)'] },
      { hairLength: 'EXTRA_LONG', priceType: 'STANDARD', pricePence: 5600, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Extra Long Hair - Wash, Haircut & Blow Dry'],
        create: { name: 'Extra Long Hair - Wash, Haircut & Blow Dry', description: 'Wash, haircut and blow dry for extra long hair.', placeholderDurationFrom: { hairLength: 'LONG', priceType: 'STANDARD' } } },
      { hairLength: 'EXTRA_LONG', priceType: 'NHS', pricePence: 5100, vatEvidence: T, priceNature: 'LISTED', legacyNames: [],
        create: { name: 'Extra Long Hair - Wash, Haircut & Blow Dry (NHS)', description: 'Wash, haircut and blow dry for extra long hair (NHS price).', placeholderDurationFrom: { hairLength: 'LONG', priceType: 'STANDARD' } } },
    ],
  },
  {
    key: 'children-haircut', category: 'Haircuts', name: "Children's Wash, Haircut & Blow Dry (12 and under)", displayOrder: 20, flags: cut,
    options: [
      { hairLength: 'SHORT', priceType: 'STANDARD', pricePence: 1900, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Children (Up to 12Yr) - Short Over Ears'] },
      { hairLength: 'LONG', priceType: 'STANDARD', pricePence: 2200, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Children (Up to 12Yr) - Long Hair'] },
      { hairLength: 'EXTRA_LONG', priceType: 'STANDARD', pricePence: 2800, vatEvidence: T, priceNature: 'LISTED', legacyNames: [],
        create: { name: 'Children (Up to 12Yr) - Extra Long Hair', description: 'Wash, haircut and blow dry for children under 12 with extra long hair.', placeholderDurationFrom: { hairLength: 'LONG', priceType: 'STANDARD' } } },
    ],
  },
  {
    key: 'full-head-colour', category: 'Colouring', name: 'Full Head Colour & Blow Dry', displayOrder: 30, flags: colour,
    priceNote: 'The price may be adjusted after your consultation.',
    options: [
      { hairLength: 'SHORT', priceType: 'STANDARD', pricePence: 12100, vatEvidence: T, priceNature: 'SUBJECT_TO_CONSULTATION', legacyNames: ['Full Head Colour & Blow Dry - Short Hair'] },
      { hairLength: 'SHORT', priceType: 'NHS', pricePence: 10900, vatEvidence: T, priceNature: 'SUBJECT_TO_CONSULTATION', legacyNames: ['Full Head Colour & Blow Dry - Short Hair (NHS)'] },
      { hairLength: 'MEDIUM', priceType: 'STANDARD', pricePence: 14500, vatEvidence: T, priceNature: 'SUBJECT_TO_CONSULTATION', legacyNames: ['Full Head Colour & Blow Dry - Medium Hair'] },
      { hairLength: 'MEDIUM', priceType: 'NHS', pricePence: 13100, vatEvidence: T, priceNature: 'SUBJECT_TO_CONSULTATION', legacyNames: ['Full Head Colour & Blow Dry - Medium Hair (NHS)'] },
      { hairLength: 'LONG', priceType: 'STANDARD', pricePence: 15700, vatEvidence: T, priceNature: 'SUBJECT_TO_CONSULTATION', legacyNames: ['Full Head Colour & Blow Dry - Long Hair'] },
      { hairLength: 'LONG', priceType: 'NHS', pricePence: 14200, vatEvidence: T, priceNature: 'SUBJECT_TO_CONSULTATION', legacyNames: ['Full Head Colour & Blow Dry - Long Hair (NHS)'] },
      { hairLength: 'EXTRA_LONG', priceType: 'STANDARD', pricePence: 19400, vatEvidence: 'OWNER_POLICY_COMPOSITE', priceNature: 'SUBJECT_TO_CONSULTATION', legacyNames: [],
        surcharge: { baseHairLength: 'LONG', amountPence: 3700, label: 'Adds Extra Long' },
        create: { name: 'Full Head Colour & Blow Dry - Extra Long Hair', description: 'Full head colour application including blow dry for extra long hair (long-hair price plus the extra-long charge).', placeholderDurationFrom: { hairLength: 'LONG', priceType: 'STANDARD' } } },
      { hairLength: 'EXTRA_LONG', priceType: 'NHS', pricePence: 17900, vatEvidence: 'OWNER_POLICY_COMPOSITE', priceNature: 'SUBJECT_TO_CONSULTATION', legacyNames: [],
        surcharge: { baseHairLength: 'LONG', amountPence: 3700, label: 'Adds Extra Long' },
        create: { name: 'Full Head Colour & Blow Dry - Extra Long Hair (NHS)', description: 'Full head colour application including blow dry for extra long hair (NHS long-hair price plus the extra-long charge).', placeholderDurationFrom: { hairLength: 'LONG', priceType: 'STANDARD' } } },
    ],
  },
  {
    key: 'half-head-highlights', category: 'Colouring', name: 'Half Head Highlights & Blow Dry', displayOrder: 40, flags: colour,
    options: [
      { hairLength: 'SHORT', priceType: 'STANDARD', pricePence: 18100, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Half Head Highlights & Blow Dry - Short Hair'] },
      { hairLength: 'SHORT', priceType: 'NHS', pricePence: 16400, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Half Head Highlights & Blow Dry - Short Hair (NHS)'] },
      { hairLength: 'LONG', priceType: 'STANDARD', pricePence: 21800, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Half Head Highlights & Blow Dry - Long Hair'] },
      { hairLength: 'LONG', priceType: 'NHS', pricePence: 19600, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Half Head Highlights & Blow Dry - Long Hair (NHS)'] },
    ],
  },
  {
    key: 'full-head-highlights', category: 'Colouring', name: 'Full Head Highlights & Blow Dry', displayOrder: 50, flags: colour,
    options: [
      { hairLength: 'SHORT', priceType: 'STANDARD', pricePence: 21100, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Full Head Highlights & Blow Dry - Short Hair'] },
      { hairLength: 'SHORT', priceType: 'NHS', pricePence: 19600, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Full Head Highlights & Blow Dry - Short Hair (NHS)'] },
      { hairLength: 'LONG', priceType: 'STANDARD', pricePence: 27800, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Full Head Highlights & Blow Dry - Long Hair'] },
      { hairLength: 'LONG', priceType: 'NHS', pricePence: 25100, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Full Head Highlights & Blow Dry - Long Hair (NHS)'] },
    ],
  },
  {
    key: 'partial-highlights', category: 'Colouring', name: 'Partial Highlights & Blow Dry', displayOrder: 60, flags: colour,
    options: [
      { hairLength: 'SHORT', priceType: 'STANDARD', pricePence: 18200, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Partial Highlights & Blow Dry - Short Hair'] },
      { hairLength: 'SHORT', priceType: 'NHS', pricePence: 16500, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Partial Highlights & Blow Dry - Short Hair (NHS)'] },
      { hairLength: 'LONG', priceType: 'STANDARD', pricePence: 27800, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Partial Highlights & Blow Dry - Long Hair'] },
      { hairLength: 'LONG', priceType: 'NHS', pricePence: 25100, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Partial Highlights & Blow Dry - Long Hair (NHS)'] },
    ],
  },
  {
    key: 'balayage', category: 'Colouring', name: 'Balayage, Haircut & Blow Dry', displayOrder: 70, flags: colour,
    options: [
      { hairLength: null, priceType: 'STANDARD', pricePence: 33900, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Balayage, Haircut & Blow Dry (Adult)'] },
      { hairLength: null, priceType: 'NHS', pricePence: 30300, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Balayage, Haircut & Blow Dry (NHS)'] },
    ],
  },
  {
    key: 'cold-perm-half-head', category: 'Perms', name: 'Cold Perm – Half Head', displayOrder: 80, flags: byConsultation,
    options: [{ hairLength: null, priceType: 'STANDARD', pricePence: 15700, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Cold Perm Half Head'] }],
  },
  {
    key: 'cold-perm-full-head', category: 'Perms', name: 'Cold Perm – Full Head', displayOrder: 90, flags: byConsultation,
    options: [{ hairLength: null, priceType: 'STANDARD', pricePence: 19400, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Cold Perm Full Head'] }],
  },
  {
    key: 'hair-correction', category: 'Perms', name: 'Hair Correction', displayOrder: 100, flags: byConsultation,
    options: [{ hairLength: null, priceType: 'STANDARD', pricePence: 24200, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Hair Correction'] }],
  },
  {
    key: 'keratin-treatment', category: 'Perms', name: 'Keratin Treatment', displayOrder: 110, flags: byConsultation,
    options: [{ hairLength: null, priceType: 'STANDARD', pricePence: 24200, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Keratin Treatment'] }],
  },
  {
    key: 'paimore-hot-perm', category: 'Perms', name: 'Paimore Hot Perm', displayOrder: 120, flags: byConsultation,
    options: [{ hairLength: null, priceType: 'STANDARD', pricePence: 24200, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Paimore Hot Perm'] }],
  },
  {
    key: 'inkarami-treatment', category: 'Treatments', name: 'Dr.Jr. TOKIO Inkarami System Treatment', displayOrder: 130, flags: cut,
    options: [
      { hairLength: null, priceType: 'STANDARD', pricePence: 15400, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Dr.Jr. TOKIO Inkarami System Treatment'] },
      { hairLength: null, priceType: 'NHS', pricePence: 14300, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Dr.Jr. TOKIO Inkarami System Treatment (NHS)'] },
    ],
  },
  {
    key: 'shampoo-blow-dry', category: 'Styling', name: 'Shampoo & Blow Dry', displayOrder: 140, flags: byConsultation,
    options: [
      { hairLength: 'SHORT', priceType: 'STANDARD', pricePence: 3000, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Shampoo & Blow Dry - Short Over Ears'] },
      { hairLength: 'SHORT', priceType: 'NHS', pricePence: 2500, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Shampoo & Blow Dry - Short Over Ears (Student & NHS)'] },
      { hairLength: 'LONG', priceType: 'STANDARD', pricePence: 4000, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Shampoo & Blow Dry - Long Over Ears'] },
      { hairLength: 'LONG', priceType: 'NHS', pricePence: 3500, vatEvidence: T, priceNature: 'LISTED', legacyNames: ['Shampoo & Blow Dry - Long Over Ears (Student & NHS)'] },
      { hairLength: 'EXTRA_LONG', priceType: 'STANDARD', pricePence: 5000, vatEvidence: T, priceNature: 'LISTED', legacyNames: [],
        create: { name: 'Shampoo & Blow Dry - Extra Long Hair', description: 'Shampoo and blow dry for extra long hair.', placeholderDurationFrom: { hairLength: 'LONG', priceType: 'STANDARD' } } },
      { hairLength: 'EXTRA_LONG', priceType: 'NHS', pricePence: 4500, vatEvidence: T, priceNature: 'LISTED', legacyNames: [],
        create: { name: 'Shampoo & Blow Dry - Extra Long Hair (NHS)', description: 'Shampoo and blow dry for extra long hair (NHS price).', placeholderDurationFrom: { hairLength: 'LONG', priceType: 'STANDARD' } } },
    ],
  },
];

/**
 * Old NHS options with no NHS price in the 2026-09-28 Treatwell check. Hidden
 * from every listing and closed to new bookings; the rows, their past
 * appointments, recorded amounts and relations stay. The standard option of
 * each service is unaffected.
 */
export const RETIRE_UNVERIFIED_NHS: { legacyName: string; standardOffering: string }[] = [
  { legacyName: 'Cold Perm Half Head (NHS)', standardOffering: 'cold-perm-half-head' },
  { legacyName: 'Cold Perm Full Head (NHS)', standardOffering: 'cold-perm-full-head' },
  { legacyName: 'Hair Correction (NHS)', standardOffering: 'hair-correction' },
  { legacyName: 'Keratin Treatment (NHS)', standardOffering: 'keratin-treatment' },
  { legacyName: 'Paimore Hot Perm (NHS)', standardOffering: 'paimore-hot-perm' },
];

/** Rows this price update deliberately leaves exactly as they are. */
export const DELIBERATELY_UNCHANGED: { legacyName: string; reason: string }[] = [
  { legacyName: 'Consultation & Patch Test', reason: 'Sensitive-test flow kept as it is (owner, 2026-09-28): no new, merged or repurposed patch tests; eligibility, validity and routing unchanged.' },
  { legacyName: 'Consultation', reason: 'Free consultation that consultation-only services route to; not part of the Treatwell list.' },
  { legacyName: 'Heat Set Add-on', reason: '£20 Special Set is on hold: no new add-on, pairing or rename, and this £10 item is NOT merged into it.' },
  { legacyName: 'Shampoo & Dry & Set', reason: '£20 Special Set is on hold: this £10 item is NOT renamed or merged into it.' },
  { legacyName: 'Perm Under Shoulder Add-on', reason: 'Not in the 2026-09-28 Treatwell check; left unchanged rather than guessed.' },
];

/** Recorded platform facts that are intentionally NOT turned into site prices. */
export const SOURCE_NOTES = [
  'Adds Extra Long £37 (Treatwell, under full-head colour): used only as the extra-long composite (long-hair price + £37). Its own VAT label was not verified.',
  'Special Set add-on £20 (Treatwell): on hold — no pairing, standalone service or booking add-on rules were created.',
  'Patch Test Can camp after Color of Perm £15 and Patch Test £15 (two Treatwell categories): not added, merged or repurposed; the site keeps its single Consultation & Patch Test flow.',
  'Cold perm has no short/medium/long tiers on Treatwell; none were created. No Paimore straight+curl or photo-only packages were added.',
  'Durations for newly created extra-long options were not confirmed; those rows take the long-hair duration as a placeholder, are flagged durationConfirmed=false and are not open for direct booking.',
];
