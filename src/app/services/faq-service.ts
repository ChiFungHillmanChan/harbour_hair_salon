import 'server-only';
import prisma from '@/app/lib/prisma';
import type { Locale } from '@/i18n/config';
import { loadPublishedTranslations, overlay } from './content/translations';

export type FaqRow = {
  id: string;
  key: string;
  question: string;
  answer: string;
  sortOrder: number;
};

/** Public FAQ list in `locale` (published translations only; English fallback per question). */
export async function getFaqsByKey(key: string, locale: Locale = 'en-GB'): Promise<(FaqRow & { translated: boolean })[]> {
  const rows = await prisma.faq.findMany({
    where: { key },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, key: true, question: true, answer: true, sortOrder: true },
  });
  if (locale === 'en-GB') return rows.map((row) => ({ ...row, translated: true }));
  const translations = await loadPublishedTranslations(prisma, 'FAQ', rows.map((row) => row.id), locale);
  return rows.map((row) => overlay(row, translations.get(row.id), ['question', 'answer']));
}

export async function getAllFaqs(): Promise<FaqRow[]> {
  const rows = await prisma.faq.findMany({
    orderBy: [{ key: 'asc' }, { sortOrder: 'asc' }],
  });
  return rows;
}

export async function getFaqById(id: string): Promise<FaqRow | null> {
  return prisma.faq.findUnique({ where: { id } });
}

export async function getAllFaqKeys(): Promise<string[]> {
  const rows = await prisma.faq.findMany({
    select: { key: true },
    distinct: ['key'],
    orderBy: { key: 'asc' },
  });
  return rows.map((r) => r.key);
}
