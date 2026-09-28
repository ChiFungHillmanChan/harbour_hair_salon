import 'server-only';
import prisma from '@/app/lib/prisma';
import { cache } from 'react';
import type { ServiceCategoryContent, Prisma } from '@prisma/client';
import type { Locale } from '@/i18n/config';
import { loadPublishedTranslations, overlay } from './content/translations';

export type ProcessStep = { step: string; detail: string };
export type CategoryFaq = { question: string; answer: string };

export type ServiceCategoryContentRuntime = {
  id: string;
  slug: string;
  category: string;
  title: string;
  hero: string;
  metaDescription: string;
  intro: string;
  overview: string[];
  includes: string[];
  process: ProcessStep[];
  aftercare: string[];
  faqs: CategoryFaq[];
  relatedSlugs: string[];
  displayOrder: number;
  updatedAt: Date;
  /** False when shown in English because no translation is published. */
  translated: boolean;
};

function safeJsonArray<T>(json: string, validator: (v: unknown) => v is T): T[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validator);
  } catch {
    return [];
  }
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isProcessStep = (v: unknown): v is ProcessStep => {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.step === 'string' && typeof obj.detail === 'string';
};
const isFaq = (v: unknown): v is CategoryFaq => {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.question === 'string' && typeof obj.answer === 'string';
};

function mapRow(row: ServiceCategoryContent): ServiceCategoryContentRuntime {
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    title: row.title,
    hero: row.hero,
    metaDescription: row.metaDescription,
    intro: row.intro,
    overview: safeJsonArray(row.overviewJson, isString),
    includes: safeJsonArray(row.includesJson, isString),
    process: safeJsonArray(row.processJson, isProcessStep),
    aftercare: safeJsonArray(row.aftercareJson, isString),
    faqs: safeJsonArray(row.faqsJson, isFaq),
    relatedSlugs: row.relatedSlugs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    displayOrder: row.displayOrder,
    updatedAt: row.updatedAt,
    translated: true,
  };
}

const TRANSLATABLE = ['title', 'hero', 'metaDescription', 'intro', 'overview', 'includes', 'process', 'aftercare', 'faqs'] as const;

/** Overlay the published translation (never a draft) for `locale`. */
async function localize(rows: ServiceCategoryContentRuntime[], locale: Locale): Promise<ServiceCategoryContentRuntime[]> {
  if (locale === 'en-GB') return rows;
  const translations = await loadPublishedTranslations(prisma, 'CATEGORY_CONTENT', rows.map((row) => row.id), locale);
  return rows.map((row) => overlay(row, translations.get(row.id), [...TRANSLATABLE]));
}

const categorySummarySelect = {
  id: true, slug: true, category: true, title: true, displayOrder: true,
} satisfies Prisma.ServiceCategoryContentSelect;

export const getAllCategoryContent = cache(async (locale: Locale = 'en-GB') => {
  const rows = await prisma.serviceCategoryContent.findMany({
    select: categorySummarySelect,
    orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }, { id: 'asc' }],
  });
  if (locale === 'en-GB') return rows.map((row) => ({ ...row, translated: true }));
  const translations = await loadPublishedTranslations(prisma, 'CATEGORY_CONTENT', rows.map((row) => row.id), locale);
  return rows.map((row) => overlay(row, translations.get(row.id), ['title']));
});

export const getCategoryContentBySlug = cache(async (slug: string, locale: Locale = 'en-GB'): Promise<ServiceCategoryContentRuntime | null> => {
  const row = await prisma.serviceCategoryContent.findUnique({ where: { slug } });
  if (!row) return null;
  const [localized] = await localize([mapRow(row)], locale);
  return localized;
});

export async function getRelatedCategories(slugs: string[], locale: Locale = 'en-GB') {
  const requested = [...new Set(slugs)].slice(0, 8);
  if (!requested.length) return [];
  const found = await prisma.serviceCategoryContent.findMany({
    where: { slug: { in: requested } },
    select: { id: true, slug: true, hero: true, intro: true },
    take: requested.length,
  });
  const translations = await loadPublishedTranslations(prisma, 'CATEGORY_CONTENT', found.map((row) => row.id), locale);
  const rows = found.map((row) => (locale === 'en-GB' ? { ...row, translated: true } : overlay(row, translations.get(row.id), ['hero', 'intro'])));
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return requested.flatMap((slug) => bySlug.has(slug) ? [bySlug.get(slug)!] : []);
}

export async function getCategoryContentById(
  id: string
): Promise<ServiceCategoryContentRuntime | null> {
  const row = await prisma.serviceCategoryContent.findUnique({ where: { id } });
  return row ? mapRow(row) : null;
}
