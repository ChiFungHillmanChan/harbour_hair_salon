import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { CategoryContentForm } from '@/components/admin/CategoryContentForm';
import { createCategoryContent } from '@/app/actions/admin-categories';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export default async function NewCategoryPage() {
  await requireAdmin();
  const [rows, t] = await Promise.all([
    prisma.service.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    }),
    getT('adminCatalog'),
  ]);
  const existingCategories = rows.map((r) => r.category);

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('categories.form.newTitle')}</h1>
        <p className="text-zinc-700 mt-2">{t('categories.form.newIntro')}</p>
      </div>
      <CategoryContentForm
        mode="create"
        action={createCategoryContent}
        existingCategories={existingCategories}
      />
    </div>
  );
}
