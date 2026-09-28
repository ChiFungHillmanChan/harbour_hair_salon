import { requireAdmin } from '@/app/lib/session';
import { notFound } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { ServiceForm } from '@/components/admin/ServiceForm';
import { BilingualContentEditor } from '@/components/admin/BilingualContentEditor';
import { updateService } from '@/app/actions/admin-services';
import { getEditorState } from '@/app/services/content/drafts';
import { formatGBP, penceToDecimalString, toPence } from '@/app/services/pricing/money';
import { getLocale, getT } from '@/i18n/server';
import { HTML_LANG } from '@/i18n/config';

export const dynamic = 'force-dynamic';

export default async function EditServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved } = await searchParams;
  const [locale, t] = await Promise.all([getLocale(), getT('adminCatalog')]);

  const [service, categories, offerings] = await Promise.all([
    prisma.service.findUnique({ where: { id }, include: { surchargeBase: { select: { name: true } } } }),
    prisma.service.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    }),
    prisma.serviceOffering.findMany({ select: { id: true, key: true, name: true }, orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }] }),
  ]);

  if (!service) notFound();
  const editor = await prisma.$transaction((tx) => getEditorState(tx, 'SERVICE', service.id));
  const composite = service.surchargeBaseServiceId && service.surchargeAmount !== null
    ? { baseName: service.surchargeBase?.name ?? '—', surcharge: formatGBP(toPence(service.surchargeAmount), HTML_LANG[locale]) }
    : null;

  const serviceLite = {
    id: service.id,
    duration: service.duration,
    category: service.category,
    imageUrl: service.imageUrl,
    requiresPatchTest: service.requiresPatchTest,
    isPatchTest: service.isPatchTest,
    requiresConsultation: service.requiresConsultation,
    isConsultation: service.isConsultation,
    treatwellExternalId: service.treatwellExternalId,
    calendarColor: service.calendarColor,
    offeringId: service.offeringId,
    hairLength: service.hairLength,
    priceType: service.priceType,
    vatDisplay: service.vatDisplay,
    priceNature: service.priceNature,
    isPublic: service.isPublic,
    isBookable: service.isBookable,
    durationConfirmed: service.durationConfirmed,
    composite,
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('serviceForm.editTitle')}</h1>
        <p className="text-zinc-700 mt-2 text-sm">{service.name} · {service.category}</p>
      </div>
      <BilingualContentEditor
        mode="edit"
        type="SERVICE"
        entityId={service.id}
        initial={{
          revision: editor.revision,
          working: editor.working,
          review: editor.review,
          shared: editor.shared,
          hasDraft: editor.hasDraft,
          draftUpdatedAt: editor.draftUpdatedAt,
        }}
        sharedPrice={{
          value: penceToDecimalString(toPence(service.price)),
          editable: !composite,
          note: composite ? t('serviceForm.composite', { base: composite.baseName, surcharge: composite.surcharge }) : undefined,
        }}
      />
      <ServiceForm
        mode="edit"
        action={updateService}
        service={serviceLite}
        saved={Boolean(saved)}
        existingCategories={categories.map((c) => c.category)}
        offerings={offerings}
      />
    </div>
  );
}
