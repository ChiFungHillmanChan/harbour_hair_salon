import prisma from '@/app/lib/prisma';
import type { Locale } from '@/i18n/config';
import { publicServiceSelect, type ClientPublicService } from '../public-service-select';
import { loadPublishedTranslations, overlay } from '../content/translations';
import { toPence } from './money';
import { HAIR_LENGTH_ORDER, isHairLength } from './policy';

export const CATEGORY_ORDER = ['Haircuts', 'Colouring', 'Perms', 'Treatments', 'Styling'] as const;

export type ClientOffering = {
  id: string;
  key: string;
  category: string;
  name: string;
  description: string | null;
  translated: boolean;
  displayOrder: number;
  searchText: string;
};

/** One row of the price list: a menu item with its length × standard/NHS options, or a standalone service. */
export type PriceListEntry =
  | { kind: 'offering'; offering: ClientOffering; options: ClientPublicService[] }
  | { kind: 'single'; service: ClientPublicService };

export type PublicCatalog = {
  services: ClientPublicService[];
  offerings: ClientOffering[];
  /** Categories in menu order, each with its entries in display order. */
  categories: { category: string; entries: PriceListEntry[] }[];
};

function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.findIndex((known) => category.includes(known));
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function optionRank(service: Pick<ClientPublicService, 'hairLength' | 'priceType'>): number {
  const length = isHairLength(service.hairLength) ? HAIR_LENGTH_ORDER[service.hairLength] : -1;
  return length * 2 + (service.priceType === 'NHS' ? 1 : 0);
}

/**
 * Everything the public price displays need, in one language, from one
 * definition: home page menu, services list, category pages, JSON-LD and the
 * booking wizard all read THIS, so they cannot disagree on an option or price.
 *
 * Only `isPublic` rows are read — retired options (e.g. unverified NHS prices)
 * never reach a public page, search result, structured data or the wizard.
 * Translations are the PUBLISHED ones only.
 */
export async function getPublicCatalog(locale: Locale): Promise<PublicCatalog> {
  const rows = await prisma.service.findMany({ where: { isPublic: true }, select: publicServiceSelect, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  const offeringIds = [...new Set(rows.flatMap((row) => (row.offeringId ? [row.offeringId] : [])))];
  const [offeringRows, serviceTranslations, offeringTranslations] = await Promise.all([
    offeringIds.length
      ? prisma.serviceOffering.findMany({ where: { id: { in: offeringIds } }, select: { id: true, key: true, category: true, name: true, description: true, displayOrder: true } })
      : Promise.resolve([]),
    loadPublishedTranslations(prisma, 'SERVICE', rows.map((row) => row.id), locale),
    loadPublishedTranslations(prisma, 'SERVICE_OFFERING', offeringIds, locale),
  ]);

  const services: ClientPublicService[] = rows.map((row) => {
    const { price, surchargeAmount, ...rest } = row;
    const { translated, ...localized } = overlay(rest, serviceTranslations.get(row.id), ['name', 'description', 'priceNote']);
    const amountPence = toPence(price);
    return {
      ...localized,
      price: amountPence / 100,
      amountPence,
      surchargeAmountPence: surchargeAmount === null ? null : toPence(surchargeAmount),
      searchText: `${row.name} ${localized.name}`.toLowerCase(),
      translated: locale === 'en-GB' || translated,
    };
  });

  const offerings: ClientOffering[] = offeringRows.map((row) => {
    const localized = overlay(row, offeringTranslations.get(row.id), ['name', 'description']);
    return {
      id: row.id,
      key: row.key,
      category: row.category,
      name: localized.name,
      description: localized.description,
      translated: locale === 'en-GB' || localized.translated,
      displayOrder: row.displayOrder,
      searchText: `${row.name} ${localized.name}`.toLowerCase(),
    };
  });

  const offeringById = new Map(offerings.map((offering) => [offering.id, offering]));
  const byCategory = new Map<string, PriceListEntry[]>();
  const optionsByOffering = new Map<string, ClientPublicService[]>();
  for (const service of services) {
    if (service.offeringId && offeringById.has(service.offeringId)) {
      const list = optionsByOffering.get(service.offeringId) ?? [];
      list.push(service);
      optionsByOffering.set(service.offeringId, list);
    } else {
      const list = byCategory.get(service.category) ?? [];
      list.push({ kind: 'single', service });
      byCategory.set(service.category, list);
    }
  }
  for (const [offeringId, options] of optionsByOffering) {
    const offering = offeringById.get(offeringId)!;
    options.sort((a, b) => optionRank(a) - optionRank(b));
    const list = byCategory.get(offering.category) ?? [];
    list.push({ kind: 'offering', offering, options });
    byCategory.set(offering.category, list);
  }
  const entryOrder = (entry: PriceListEntry) => (entry.kind === 'offering' ? entry.offering.displayOrder : 10_000);
  const categories = [...byCategory.entries()]
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
    .map(([category, entries]) => ({
      category,
      entries: entries.sort((a, b) => entryOrder(a) - entryOrder(b)
        || (a.kind === 'single' && b.kind === 'single' ? a.service.name.localeCompare(b.service.name) : 0)),
    }));

  return { services, offerings, categories };
}

/**
 * The lowest and highest STANDARD price in a list — what "from £x" and
 * JSON-LD price ranges quote. An NHS price is only available to NHS staff, so
 * it is never presented as the price everyone can get.
 */
export function standardPriceRange(services: readonly Pick<ClientPublicService, 'amountPence' | 'priceType'>[]): { min: number; max: number } | null {
  const standard = services.filter((service) => service.priceType !== 'NHS').map((service) => service.amountPence);
  if (standard.length === 0) return null;
  return { min: Math.min(...standard), max: Math.max(...standard) };
}
