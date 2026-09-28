import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGBP, penceToDecimalString, toPence } from './money';
import { buildQuote, parseQuote, QuoteIntegrityError, quoteMatches, serializeQuote, type QuotableService } from './quote';
import { recordedPrice } from './recorded-price';
import { DISCOUNTS_PAUSED } from './policy';
import { OFFERINGS, RETIRE_UNVERIFIED_NHS, DELIBERATELY_UNCHANGED } from '../../../../prisma/price-catalog/treatwell-2026-09-28';

const service = (overrides: Partial<QuotableService> = {}): QuotableService => ({
  id: 'svc', price: '157.000000000000000000000000000000', duration: 150, offeringId: 'off', hairLength: 'LONG', priceType: 'STANDARD',
  priceVersion: 3, vatDisplay: 'EXCLUDED', priceNature: 'SUBJECT_TO_CONSULTATION', durationConfirmed: true,
  surchargeBaseServiceId: null, surchargeAmount: null, priceSource: 'treatwell:2026-09-28', ...overrides,
});

test('money converts Decimal strings exactly, never through a float', () => {
  assert.equal(toPence('157.000000000000000000000000000000'), 15700);
  assert.equal(toPence('44.99'), 4499);
  assert.equal(toPence('0.1'), 10);
  assert.equal(toPence(19.99), 1999);
  assert.equal(toPence('33.335'), 3334);
  assert.equal(penceToDecimalString(19400), '194.00');
  assert.equal(penceToDecimalString(5), '0.05');
  assert.equal(formatGBP(19400, 'en-GB'), '£194.00');
  assert.equal(formatGBP(19400, 'zh-HK', { wholePounds: true }), '£194');
  assert.throws(() => toPence('abc'));
});

test('a quote carries amount, type, VAT wording and version — never a discount', () => {
  const quote = buildQuote(service());
  assert.equal(quote.amountPence, 15700);
  assert.equal(quote.priceType, 'STANDARD');
  assert.equal(quote.vatDisplay, 'EXCLUDED');
  assert.equal(quote.priceNature, 'SUBJECT_TO_CONSULTATION');
  assert.equal(quote.discountsApplied, false);
  assert.deepEqual(quote.breakdown, [{ kind: 'LISTED', amountPence: 15700 }]);
  assert.equal(DISCOUNTS_PAUSED, true);
  assert.deepEqual(parseQuote(serializeQuote(quote)), quote);
});

test('extra-long colour is long-hair price + £37 exactly once', () => {
  const base = { id: 'long-std', price: '157.00' };
  const composite = service({ id: 'xl-std', price: '194.00', hairLength: 'EXTRA_LONG', surchargeBaseServiceId: 'long-std', surchargeAmount: '37.00' });
  const quote = buildQuote(composite, base);
  assert.equal(quote.amountPence, 19400);
  assert.deepEqual(quote.breakdown, [
    { kind: 'BASE_OPTION', serviceId: 'long-std', amountPence: 15700 },
    { kind: 'EXTRA_LONG_SURCHARGE', amountPence: 3700 },
  ]);
  const nhs = buildQuote(service({ id: 'xl-nhs', price: '179', priceType: 'NHS', hairLength: 'EXTRA_LONG', surchargeBaseServiceId: 'long-nhs', surchargeAmount: '37' }), { id: 'long-nhs', price: '142' });
  assert.equal(nhs.amountPence, 17900);
  // A stored price that already includes the surcharge is never topped up again,
  // and a mismatch (e.g. someone typed 231 = 194 + 37) is refused outright.
  assert.throws(() => buildQuote(composite.surchargeBaseServiceId ? { ...composite, price: '231' } : composite, base), QuoteIntegrityError);
  assert.throws(() => buildQuote(composite, null), QuoteIntegrityError);
  assert.throws(() => buildQuote(composite, { id: 'other', price: '157' }), QuoteIntegrityError);
});

test('a confirm is only accepted against the same service, version and amount', () => {
  const quote = buildQuote(service());
  assert.equal(quoteMatches(quote, { serviceId: 'svc', priceVersion: 3, amountPence: 15700 }), true);
  assert.equal(quoteMatches(quote, { serviceId: 'svc', priceVersion: 2, amountPence: 15700 }), false);
  assert.equal(quoteMatches(quote, { serviceId: 'svc', priceVersion: 3, amountPence: 14200 }), false);
  assert.equal(quoteMatches(quote, { serviceId: 'other', priceVersion: 3, amountPence: 15700 }), false);
  assert.equal(quoteMatches(quote, null), false);
});

test('a recorded price is never replaced by today\'s price or zero', () => {
  assert.deepEqual(recordedPrice({ priceAtBooking: null, quoteJson: null }), { known: false });
  const legacy = recordedPrice({ priceAtBooking: '80.00', quoteJson: null });
  assert.equal(legacy.known && legacy.amountPence, 8000);
  // Old bookings made no claim about NHS or VAT; neither do we.
  assert.equal(legacy.known && legacy.priceType, null);
  assert.equal(legacy.known && legacy.vatDisplay, null);
  const free = recordedPrice({ priceAtBooking: '0', quoteJson: null });
  assert.equal(free.known && free.amountPence, 0);
  const quote = buildQuote(service({ priceType: 'NHS', price: '142' }));
  const quoted = recordedPrice({ priceAtBooking: '142.00', quoteJson: serializeQuote(quote) });
  assert.equal(quoted.known && quoted.priceType, 'NHS');
  // A quote that disagrees with the committed amount is not trusted for labels.
  const drifted = recordedPrice({ priceAtBooking: '120.00', quoteJson: serializeQuote(quote) });
  assert.equal(drifted.known && drifted.priceType, null);
  assert.equal(parseQuote('{"schema":2}'), null);
  assert.equal(parseQuote('not json'), null);
});

// The owner-confirmed table (implementation prompt §3), row by row.
const CONFIRMED: [string, string | null, number, number | null][] = [
  ['wash-cut-blow-dry', 'SHORT', 37, 33], ['wash-cut-blow-dry', 'LONG', 49, 45], ['wash-cut-blow-dry', 'EXTRA_LONG', 56, 51],
  ['shampoo-blow-dry', 'SHORT', 30, 25], ['shampoo-blow-dry', 'LONG', 40, 35], ['shampoo-blow-dry', 'EXTRA_LONG', 50, 45],
  ['full-head-colour', 'SHORT', 121, 109], ['full-head-colour', 'MEDIUM', 145, 131], ['full-head-colour', 'LONG', 157, 142], ['full-head-colour', 'EXTRA_LONG', 194, 179],
  ['half-head-highlights', 'SHORT', 181, 164], ['half-head-highlights', 'LONG', 218, 196],
  ['full-head-highlights', 'SHORT', 211, 196], ['full-head-highlights', 'LONG', 278, 251],
  ['partial-highlights', 'SHORT', 182, 165], ['partial-highlights', 'LONG', 278, 251],
  ['balayage', null, 339, 303],
  ['children-haircut', 'SHORT', 19, null], ['children-haircut', 'LONG', 22, null], ['children-haircut', 'EXTRA_LONG', 28, null],
  ['cold-perm-half-head', null, 157, null], ['cold-perm-full-head', null, 194, null],
  ['hair-correction', null, 242, null], ['keratin-treatment', null, 242, null], ['paimore-hot-perm', null, 242, null],
  ['inkarami-treatment', null, 154, 143],
];

test('the catalogue matches the confirmed price table exactly, with no extra NHS options', () => {
  const options = OFFERINGS.flatMap((offering) => offering.options.map((option) => ({ key: offering.key, ...option })));
  const find = (key: string, length: string | null, type: string) => options.filter((o) => o.key === key && o.hairLength === length && o.priceType === type);
  for (const [key, length, standard, nhs] of CONFIRMED) {
    assert.deepEqual(find(key, length, 'STANDARD').map((o) => o.pricePence), [standard * 100], `${key} ${length} standard`);
    assert.deepEqual(find(key, length, 'NHS').map((o) => o.pricePence), nhs === null ? [] : [nhs * 100], `${key} ${length} NHS`);
  }
  assert.equal(options.length, CONFIRMED.reduce((sum, [, , , nhs]) => sum + (nhs === null ? 1 : 2), 0), 'no option beyond the table');
  assert.equal(new Set(options.map((o) => `${o.key}|${o.hairLength}|${o.priceType}`)).size, options.length, 'each option once');
  // Every catalogued option is labelled VAT excluded (owner display policy).
  assert.ok(options.every((o) => ['TREATWELL_LABEL', 'OWNER_POLICY_COMPOSITE'].includes(o.vatEvidence)));
  // Only the composite leans on owner policy — the £37 add-on's own label is unverified.
  assert.deepEqual(options.filter((o) => o.vatEvidence === 'OWNER_POLICY_COMPOSITE').map((o) => o.pricePence).sort(), [17900, 19400]);
  // No cold-perm length tiers were invented.
  assert.ok(options.filter((o) => o.key.startsWith('cold-perm')).every((o) => o.hairLength === null));
});

test('the extra-long composite is £157 + £37 and £142 + £37, and nothing else carries the £37', () => {
  const colour = OFFERINGS.find((o) => o.key === 'full-head-colour')!;
  const composites = colour.options.filter((o) => o.surcharge);
  assert.equal(composites.length, 2);
  for (const option of composites) {
    const base = colour.options.find((o) => o.hairLength === option.surcharge!.baseHairLength && o.priceType === option.priceType)!;
    assert.equal(base.pricePence + option.surcharge!.amountPence, option.pricePence);
    assert.equal(option.surcharge!.amountPence, 3700);
  }
  assert.equal(OFFERINGS.flatMap((o) => o.options).filter((o) => o.surcharge).length, 2);
});

test('unverified NHS options retire and sensitive tests / Special Set stay untouched', () => {
  assert.deepEqual(RETIRE_UNVERIFIED_NHS.map((r) => r.legacyName).sort(), [
    'Cold Perm Full Head (NHS)', 'Cold Perm Half Head (NHS)', 'Hair Correction (NHS)', 'Keratin Treatment (NHS)', 'Paimore Hot Perm (NHS)',
  ]);
  const unchanged = DELIBERATELY_UNCHANGED.map((r) => r.legacyName);
  assert.ok(unchanged.includes('Consultation & Patch Test'));
  assert.ok(unchanged.includes('Heat Set Add-on'));
  const legacy = new Set(OFFERINGS.flatMap((o) => o.options.flatMap((option) => option.legacyNames)));
  for (const name of [...unchanged, ...RETIRE_UNVERIFIED_NHS.map((r) => r.legacyName)]) assert.equal(legacy.has(name), false, name);
  // Hair Correction keeps its English name in every language (brand-like term).
  assert.ok(OFFERINGS.some((o) => o.key === 'hair-correction' && o.name === 'Hair Correction'));
});
