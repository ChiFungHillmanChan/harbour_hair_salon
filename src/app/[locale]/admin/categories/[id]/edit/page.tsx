import { requireAdmin } from '@/app/lib/session';
import { notFound } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { CategoryContentForm } from '@/components/admin/CategoryContentForm';
import { BilingualContentEditor } from '@/components/admin/BilingualContentEditor';
import { updateCategoryContent } from '@/app/actions/admin-categories';
import { getCategoryContentById } from '@/app/services/category-content-service';
import { getEditorState } from '@/app/services/content/drafts';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export default async function EditCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved } = await searchParams;

  const [content, categoryRows, t] = await Promise.all([
    getCategoryContentById(id),
    prisma.service.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    }),
    getT('adminCatalog'),
  ]);

  if (!content) notFound();
  const editor = await prisma.$transaction((tx) => getEditorState(tx, 'CATEGORY_CONTENT', content.id));

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('categories.form.editTitle')}</h1>
        <p className="text-zinc-700 mt-2 font-mono text-sm">/services/{content.slug}</p>
      </div>
      <BilingualContentEditor
        mode="edit"
        type="CATEGORY_CONTENT"
        entityId={content.id}
        initial={{
          revision: editor.revision,
          working: editor.working,
          review: editor.review,
          shared: editor.shared,
          hasDraft: editor.hasDraft,
          draftUpdatedAt: editor.draftUpdatedAt,
        }}
      />
      <CategoryContentForm
        mode="edit"
        action={updateCategoryContent}
        content={{
          id: content.id,
          slug: content.slug,
          category: content.category,
          relatedSlugs: content.relatedSlugs,
          displayOrder: content.displayOrder,
        }}
        saved={Boolean(saved)}
        existingCategories={categoryRows.map((r) => r.category)}
      />
    </div>
  );
}
