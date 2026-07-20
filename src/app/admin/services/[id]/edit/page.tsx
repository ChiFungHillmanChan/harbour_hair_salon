import { notFound } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { ServiceForm } from '@/components/admin/ServiceForm';
import { updateService } from '@/app/actions/admin-services';

export const dynamic = 'force-dynamic';

export default async function EditServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;

  const [service, categories] = await Promise.all([
    prisma.service.findUnique({ where: { id } }),
    prisma.service.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    }),
  ]);

  if (!service) notFound();

  const serviceLite = {
    id: service.id,
    name: service.name,
    description: service.description,
    price: Number(service.price),
    duration: service.duration,
    category: service.category,
    imageUrl: service.imageUrl,
    requiresPatchTest: service.requiresPatchTest,
    isPatchTest: service.isPatchTest,
    requiresConsultation: service.requiresConsultation,
    isConsultation: service.isConsultation,
    treatwellExternalId: service.treatwellExternalId,
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Edit service</h1>
        <p className="text-zinc-700 mt-2 text-sm">{service.category}</p>
      </div>
      <ServiceForm
        mode="edit"
        action={updateService}
        service={serviceLite}
        saved={Boolean(saved)}
        existingCategories={categories.map((c) => c.category)}
      />
    </div>
  );
}
