import type { ClientPublicService } from '../public-service-select';
import type { PriceListEntry } from './public-catalog';
import { penceToDecimalString } from './money';

type Labels = {
  /** "Short hair" etc. for an option inside a menu item. */
  hairLength: (length: string) => string;
  /** Fallback description, e.g. "{name} at Harbour Hair Salon". */
  describe: (name: string) => string;
};

/**
 * schema.org Offer for one option. Only STANDARD prices are published: an NHS
 * price is not available to everyone, so structured data never advertises it
 * as the price of the service. A price the menu shows as "VAT excluded" says
 * so (valueAddedTaxIncluded: false) instead of implying a final total.
 */
function offerFor(option: ClientPublicService, name: string | undefined) {
  const price = penceToDecimalString(option.amountPence);
  return {
    '@type': 'Offer' as const,
    ...(name ? { name } : {}),
    price,
    priceCurrency: 'GBP',
    ...(option.vatDisplay === 'EXCLUDED'
      ? { priceSpecification: { '@type': 'PriceSpecification' as const, price, priceCurrency: 'GBP', valueAddedTaxIncluded: false } }
      : {}),
  };
}

/** Service items for an OfferCatalog, from the same catalogue the page renders. */
export function serviceSchemaItems(entries: PriceListEntry[], labels: Labels, extra: Record<string, unknown> = {}) {
  return entries.flatMap((entry) => {
    const options = entry.kind === 'offering' ? entry.options : [entry.service];
    const standard = options.filter((option) => option.priceType !== 'NHS');
    if (standard.length === 0) return [];
    const name = entry.kind === 'offering' ? entry.offering.name : entry.service.name;
    const description = (entry.kind === 'offering' ? entry.offering.description : entry.service.description) || labels.describe(name);
    const offers = standard.map((option) => offerFor(option, entry.kind === 'offering' && option.hairLength ? labels.hairLength(option.hairLength) : undefined));
    return [{
      '@type': 'Service' as const,
      name,
      description,
      offers: offers.length === 1 ? offers[0] : offers,
      ...extra,
    }];
  });
}
