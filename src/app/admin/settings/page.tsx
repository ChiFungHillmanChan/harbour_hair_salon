import Link from 'next/link';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { SiteSettingsForm } from '@/components/admin/SiteSettingsForm';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const settings = await getSiteSettings();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Site settings</h1>
        <p className="text-zinc-700 mt-2">
          Social links, verification codes and contact details. Changes propagate to the home page{' '}
          <Link href="/" className="underline hover:text-zinc-900">
            HairSalon schema
          </Link>{' '}
          and site-wide metadata.
        </p>
      </div>
      <SiteSettingsForm settings={settings} />
    </div>
  );
}
