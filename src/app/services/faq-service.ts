import 'server-only';
import prisma from '@/app/lib/prisma';

export type FaqRow = {
  id: string;
  key: string;
  question: string;
  answer: string;
  sortOrder: number;
};

export async function getFaqsByKey(key: string): Promise<FaqRow[]> {
  const rows = await prisma.faq.findMany({
    where: { key },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows;
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
