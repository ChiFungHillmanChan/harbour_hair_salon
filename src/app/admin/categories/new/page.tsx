import prisma from '@/app/lib/prisma';
import { CategoryContentForm } from '@/components/admin/CategoryContentForm';
import { createCategoryContent } from '@/app/actions/admin-categories';

export const dynamic = 'force-dynamic';

export default async function NewCategoryPage() {
  const rows = await prisma.service.findMany({
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  const existingCategories = rows.map((r) => r.category);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">New category page</h1>
        <p className="text-zinc-700 mt-2">
          Long-form SEO content for a new category detail page.
        </p>
      </div>
      <CategoryContentForm
        mode="create"
        action={createCategoryContent}
        existingCategories={existingCategories}
      />
    </div>
  );
}
