import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { ServiceForm } from '@/components/admin/ServiceForm';
import { createService } from '@/app/actions/admin-services';
import { getT } from '@/i18n/server';

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
  const [existingCategories, offerings, t] = await Promise.all([
    getExistingCategories(),
    prisma.serviceOffering.findMany({ select: { id: true, key: true, name: true }, orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }] }),
    getT('adminCatalog'),
  ]);

  return (
    <div className="p-3 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-4 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('serviceForm.newTitle')}</h1>
        <p className="text-zinc-700 mt-1 text-sm sm:mt-2 sm:text-base">{t('serviceForm.newIntro')}</p>
      </div>
      <ServiceForm mode="create" action={createService} existingCategories={existingCategories} offerings={offerings} />
    </div>
  );
}
