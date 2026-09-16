import 'server-only';
import prisma from '@/app/lib/prisma';
import { cache } from 'react';
import type { ServiceCategoryContent, Prisma } from '@prisma/client';

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
  };
}

const categorySummarySelect = {
  id: true, slug: true, category: true, title: true, displayOrder: true,
} satisfies Prisma.ServiceCategoryContentSelect;

export const getAllCategoryContent = cache(async () => {
  return prisma.serviceCategoryContent.findMany({
    select: categorySummarySelect,
    orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }, { id: 'asc' }],
  });
});

export const getCategoryContentBySlug = cache(async (slug: string): Promise<ServiceCategoryContentRuntime | null> => {
  const row = await prisma.serviceCategoryContent.findUnique({ where: { slug } });
  return row ? mapRow(row) : null;
});

export async function getRelatedCategories(slugs: string[]) {
  const requested = [...new Set(slugs)].slice(0, 8);
  if (!requested.length) return [];
  const rows = await prisma.serviceCategoryContent.findMany({
    where: { slug: { in: requested } },
    select: { slug: true, hero: true, intro: true },
    take: requested.length,
  });
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return requested.flatMap((slug) => bySlug.has(slug) ? [bySlug.get(slug)!] : []);
}

export async function getCategoryContentById(
  id: string
): Promise<ServiceCategoryContentRuntime | null> {
  const row = await prisma.serviceCategoryContent.findUnique({ where: { id } });
  return row ? mapRow(row) : null;
}
