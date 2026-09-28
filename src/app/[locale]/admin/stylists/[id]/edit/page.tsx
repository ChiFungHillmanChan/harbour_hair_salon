import { requireAdmin } from '@/app/lib/session';
import { notFound } from 'next/navigation';
import { StylistForm } from '@/components/admin/StylistForm';
import { BilingualContentEditor } from '@/components/admin/BilingualContentEditor';
import { updateStylist } from '@/app/actions/admin-stylists';
import { getStylistById } from '@/app/stylists/slug';
import { getEditorState } from '@/app/services/content/drafts';
import prisma from '@/app/lib/prisma';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export default async function EditStylistPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved } = await searchParams;
  const [stylist, t] = await Promise.all([getStylistById(id), getT('adminContent')]);
  if (!stylist) notFound();

  // Keep the private API mapping out of the public-facing StylistRuntime.
  const [integration, editor] = await Promise.all([
    prisma.stylist.findUnique({
      where: { id },
      select: { treatwellExternalId: true, calendarColor: true },
    }),
    prisma.$transaction((tx) => getEditorState(tx, 'STYLIST', stylist.id)),
  ]);

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('stylists.form.editTitle')}</h1>
        <p className="text-zinc-700 mt-2 text-sm">
          {stylist.name} · <span className="font-mono">/stylists/{stylist.slug}</span>
        </p>
      </div>
      <BilingualContentEditor
        mode="edit"
        type="STYLIST"
        entityId={stylist.id}
        initial={{
          revision: editor.revision,
          working: editor.working,
          review: editor.review,
          shared: editor.shared,
          hasDraft: editor.hasDraft,
          draftUpdatedAt: editor.draftUpdatedAt,
        }}
      />
      <StylistForm
        mode="edit"
        action={updateStylist}
        stylist={{
          id: stylist.id,
          name: stylist.name,
          slug: stylist.slug,
          imageUrl: stylist.imageUrl,
          yearsExperience: stylist.yearsExperience,
        }}
        saved={Boolean(saved)}
        treatwellExternalId={integration?.treatwellExternalId ?? null}
        calendarColor={integration?.calendarColor ?? null}
      />
    </div>
  );
}
