import 'server-only';
import prisma from '@/app/lib/prisma';

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

type DbRow = {
  id: string;
  slug: string;
  category: string;
  title: string;
  hero: string;
  metaDescription: string;
  intro: string;
  overviewJson: string;
  includesJson: string;
  processJson: string;
  aftercareJson: string;
  faqsJson: string;
  relatedSlugs: string;
  displayOrder: number;
  updatedAt: Date;
};

function mapRow(row: DbRow): ServiceCategoryContentRuntime {
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

export async function getAllCategoryContent(): Promise<ServiceCategoryContentRuntime[]> {
  const rows = await prisma.serviceCategoryContent.findMany({
    orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }],
  });
  return rows.map(mapRow);
}

export async function getCategoryContentBySlug(
  slug: string
): Promise<ServiceCategoryContentRuntime | null> {
  const row = await prisma.serviceCategoryContent.findUnique({ where: { slug } });
  return row ? mapRow(row) : null;
}

export async function getCategoryContentById(
  id: string
): Promise<ServiceCategoryContentRuntime | null> {
  const row = await prisma.serviceCategoryContent.findUnique({ where: { id } });
  return row ? mapRow(row) : null;
}
