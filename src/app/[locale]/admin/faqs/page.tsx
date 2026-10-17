import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { unstable_rethrow } from 'next/navigation';
import { getAllFaqs, getAllFaqKeys } from '@/app/services/faq-service';
import { deleteFaq, updateFaq, type FaqActionState } from '@/app/actions/admin-faqs';
import { FaqInlineEditor } from '@/components/admin/FaqInlineEditor';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { ContentStatusBadges } from '@/components/admin/ContentStatusBadges';
import { faqKeyLabel } from '@/components/admin/faq-key-label';
import { loadContentStatus } from '@/app/services/admin-content-status';
import { getActionT } from '@/i18n/request';
import { getT } from '@/i18n/server';
import { rich } from '@/i18n/rich';

export const dynamic = 'force-dynamic';

/**
 * Adapts the FormData-based `deleteFaq` action to the id-bound signature
 * RowActionButton expects, so the delete can be confirmed before it runs.
 */
async function deleteFaqById(id: string): Promise<{ error?: string; success?: boolean }> {
  'use server';
  const formData = new FormData();
  formData.set('id', id);
  try {
    await deleteFaq(formData);
  } catch (error) {
    unstable_rethrow(error);
    console.error('deleteFaq failed:', error);
    const t = await getActionT('adminContent');
    return { error: t('faqs.list.deleteFailed') };
  }
  return { success: true };
}

export default async function AdminFaqsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; key?: string }>;
}) {
  await requireAdmin();
  const { saved, key: focusKey } = await searchParams;
  const [faqs, keys, t, tc] = await Promise.all([getAllFaqs(), getAllFaqKeys(), getT('adminContent'), getT('common')]);
  const contentStatus = await loadContentStatus('FAQ', faqs.map((faq) => faq.id));
  const statusLabels = { chineseMissing: t('contentStatus.chineseMissing'), draftPending: t('contentStatus.draftPending') };

  const grouped = new Map<string, typeof faqs>();
  for (const f of faqs) {
    const bucket = grouped.get(f.key) ?? [];
    bucket.push(f);
    grouped.set(f.key, bucket);
  }

  const updateFaqAction: (
    _prev: FaqActionState,
    formData: FormData
  ) => Promise<FaqActionState> = updateFaq;

  return (
    <div className="p-3 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between mb-4 gap-3 sm:mb-8 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('faqs.list.title')}</h1>
          <p className="text-sm text-zinc-700 mt-1 sm:mt-2 sm:text-base">
            {rich(t('faqs.list.intro'), {
              code: (text) => <code className="bg-zinc-100 px-1 rounded">{text}</code>,
            })}
          </p>
        </div>
        <Link
          href="/admin/faqs/new"
          className="inline-flex min-h-11 shrink-0 items-center bg-zinc-900 hover:bg-zinc-800 text-white px-4 sm:px-6 py-3 text-sm sm:uppercase sm:tracking-[0.15em] font-bold transition-colors rounded"
        >
          + {t('faqs.list.new')}
        </Link>
      </div>

      {saved && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded text-sm mb-6" role="status">
          ✓ {t('faqs.list.saved')}
        </div>
      )}

      {keys.length > 0 && (
        <details className="mb-4 rounded-lg border border-zinc-200 bg-white">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium text-zinc-700">
            {t('faqs.list.existingKeys')} <span className="text-zinc-500">({keys.length})</span>
          </summary>
          <div className="flex flex-wrap gap-2 px-3 pb-3 text-xs">
            {keys.map((k) => (
              <span
                key={k}
                className={`inline-block max-w-full break-all px-2 py-1 rounded border ${
                  focusKey === k
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white border-zinc-200 text-zinc-600'
                }`}
              >
                {k}
              </span>
            ))}
          </div>
        </details>
      )}

      {grouped.size === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg p-6 sm:p-12 text-center">
          <p className="text-zinc-500">{t('faqs.list.empty')}</p>
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-8">
          {Array.from(grouped.entries()).map(([key, items]) => (
            <section key={key} className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-50 border-b border-zinc-200 px-4 sm:px-6 py-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-700">
                  {faqKeyLabel(key, t)}
                </h2>
                <span className="text-xs text-zinc-500 font-mono break-all">{key}</span>
              </div>
              <ul className="divide-y divide-zinc-100">
                {items.map((faq) => (
                  <li key={faq.id} className="p-4 sm:p-6 space-y-3 sm:space-y-4">
                    <div>
                      <p className="break-words font-medium text-zinc-900">{faq.question}</p>
                      <p className="text-sm text-zinc-600 mt-1 line-clamp-3 break-words">{faq.answer}</p>
                      <ContentStatusBadges status={contentStatus.get(faq.id)} labels={statusLabels} />
                    </div>
                    <details className="rounded border border-zinc-200">
                      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium text-zinc-700">{t('faqs.form.placementTitle')}</summary>
                      <div className="border-t border-zinc-200 p-3">
                        <FaqInlineEditor faq={{ id: faq.id, key: faq.key, sortOrder: faq.sortOrder }} action={updateFaqAction} />
                      </div>
                    </details>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Link
                        href={`/admin/faqs/${faq.id}/edit`}
                        className="inline-flex min-h-11 items-center text-sm sm:text-xs font-medium text-zinc-900 px-3 py-2 rounded hover:bg-zinc-100 transition-colors"
                      >
                        {t('faqs.list.editText')}
                      </Link>
                      <RowActionButton
                        action={deleteFaqById.bind(null, faq.id)}
                        label={tc('actions.delete')}
                        pendingLabel={tc('actions.deleting')}
                        buttonClassName="min-h-11 text-sm sm:text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded transition-colors"
                        confirmMessage={t('faqs.list.deleteConfirm', { question: faq.question })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
