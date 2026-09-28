import { requireAdmin } from '@/app/lib/session';
import { notFound } from 'next/navigation';
import Link from '@/i18n/link';
import prisma from '@/app/lib/prisma';
import { getEditorState } from '@/app/services/content/drafts';
import { BilingualContentEditor } from '@/components/admin/BilingualContentEditor';
import { DISCOUNTS_PAUSED } from '@/app/services/pricing/policy';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

/** An offer's title and description in both languages (draft → publish). */
export default async function EditOfferTextPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [offer, t] = await Promise.all([
    prisma.offer.findUnique({ where: { id }, select: { id: true, title: true } }),
    getT('adminContent'),
  ]);
  if (!offer) notFound();
  const editor = await prisma.$transaction((tx) => getEditorState(tx, 'OFFER', offer.id));

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('offers.editPage.title')}</h1>
        <p className="text-zinc-700 mt-2 text-sm">{offer.title}</p>
      </div>
      {DISCOUNTS_PAUSED && (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="note">
          <p className="font-semibold">{t('promotions.paused.offersTitle')}</p>
          <p className="mt-1">{t('promotions.paused.offersBody')}</p>
        </div>
      )}
      <BilingualContentEditor
        mode="edit"
        type="OFFER"
        entityId={offer.id}
        initial={{
          revision: editor.revision,
          working: editor.working,
          review: editor.review,
          shared: editor.shared,
          hasDraft: editor.hasDraft,
          draftUpdatedAt: editor.draftUpdatedAt,
        }}
      />
      <Link href="/admin/offers" className="inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← {t('offers.editPage.back')}
      </Link>
    </div>
  );
}
