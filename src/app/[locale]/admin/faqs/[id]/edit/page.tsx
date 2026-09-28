import { requireAdmin } from '@/app/lib/session';
import { notFound } from 'next/navigation';
import Link from '@/i18n/link';
import prisma from '@/app/lib/prisma';
import { updateFaq } from '@/app/actions/admin-faqs';
import { getFaqById } from '@/app/services/faq-service';
import { getEditorState } from '@/app/services/content/drafts';
import { BilingualContentEditor } from '@/components/admin/BilingualContentEditor';
import { FaqInlineEditor } from '@/components/admin/FaqInlineEditor';
import { faqKeyLabel } from '@/components/admin/faq-key-label';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

/** One FAQ: its wording in both languages (draft → publish) and its placement. */
export default async function EditFaqPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [faq, t] = await Promise.all([getFaqById(id), getT('adminContent')]);
  if (!faq) notFound();
  const editor = await prisma.$transaction((tx) => getEditorState(tx, 'FAQ', faq.id));

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('faqs.form.editTitle')}</h1>
        <p className="text-zinc-700 mt-2 text-sm">
          {faqKeyLabel(faq.key, t)} · <span className="font-mono">{faq.key}</span>
        </p>
      </div>
      <BilingualContentEditor
        mode="edit"
        type="FAQ"
        entityId={faq.id}
        initial={{
          revision: editor.revision,
          working: editor.working,
          review: editor.review,
          shared: editor.shared,
          hasDraft: editor.hasDraft,
          draftUpdatedAt: editor.draftUpdatedAt,
        }}
      />
      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-3">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('faqs.form.placementTitle')}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{t('faqs.form.placementHelp')}</p>
        </div>
        <FaqInlineEditor faq={{ id: faq.id, key: faq.key, sortOrder: faq.sortOrder }} action={updateFaq} />
      </section>
      <Link href="/admin/faqs" className="inline-block text-sm text-zinc-600 hover:text-zinc-900">
        ← {t('faqs.form.backToList')}
      </Link>
    </div>
  );
}
