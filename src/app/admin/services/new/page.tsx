import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { ServiceForm } from '@/components/admin/ServiceForm';
import { createService } from '@/app/actions/admin-services';

export const dynamic = 'force-dynamic';

async function getExistingCategories(): Promise<string[]> {
  const rows = await prisma.service.findMany({
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return rows.map((r) => r.category);
}

export default async function NewServicePage() {
  await requireAdmin();
  const existingCategories = await getExistingCategories();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">New service</h1>
        <p className="text-zinc-700 mt-2">Add a service to the menu.</p>
      </div>
      <ServiceForm mode="create" action={createService} existingCategories={existingCategories} />
    </div>
  );
}
