import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import { createFaq } from '@/app/actions/admin-faqs';
import { getAllFaqKeys } from '@/app/services/faq-service';
import { NewFaqForm } from '@/components/admin/NewFaqForm';
import { getT } from '@/i18n/server';
import { rich } from '@/i18n/rich';

export const dynamic = 'force-dynamic';

export default async function NewFaqPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  await requireAdmin();
  const { key: presetKey } = await searchParams;
  const [existingKeys, t] = await Promise.all([getAllFaqKeys(), getT('adminContent')]);

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('faqs.form.newTitle')}</h1>
        <p className="text-zinc-700 mt-2">
          {rich(t('faqs.form.newIntro'), {
            code: (text) => <code className="bg-zinc-100 px-1 rounded">{text}</code>,
          })}
        </p>
      </div>
      <NewFaqForm action={createFaq} existingKeys={existingKeys} presetKey={presetKey} />
      <div className="mt-6">
        <Link href="/admin/faqs" className="text-sm text-zinc-600 hover:text-zinc-900">
          ← {t('faqs.form.backToList')}
        </Link>
      </div>
    </div>
  );
}
