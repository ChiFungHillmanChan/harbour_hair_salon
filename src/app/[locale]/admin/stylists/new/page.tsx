import { requireAdmin } from '@/app/lib/session';
import { StylistForm } from '@/components/admin/StylistForm';
import { createStylist } from '@/app/actions/admin-stylists';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export default async function NewStylistPage() {
  await requireAdmin();
  const t = await getT('adminContent');
  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">{t('stylists.form.newTitle')}</h1>
        <p className="text-zinc-700 mt-2">{t('stylists.form.newIntro')}</p>
      </div>
      <StylistForm mode="create" action={createStylist} />
    </div>
  );
}
