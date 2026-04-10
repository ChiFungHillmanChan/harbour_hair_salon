import { notFound } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { CategoryContentForm } from '@/components/admin/CategoryContentForm';
import { updateCategoryContent } from '@/app/actions/admin-categories';
import { getCategoryContentById } from '@/app/services/category-content-service';

export const dynamic = 'force-dynamic';

export default async function EditCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;

  const [content, categoryRows] = await Promise.all([
    getCategoryContentById(id),
    prisma.service.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    }),
  ]);

  if (!content) notFound();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Edit category page</h1>
        <p className="text-zinc-700 mt-2 font-mono text-sm">/services/{content.slug}</p>
      </div>
      <CategoryContentForm
        mode="edit"
        action={updateCategoryContent}
        content={content}
        saved={Boolean(saved)}
        existingCategories={categoryRows.map((r) => r.category)}
      />
    </div>
  );
}
