import { requireAdmin } from '@/app/lib/session';
import Link from '@/i18n/link';
import prisma from '@/app/lib/prisma';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { getEditorState } from '@/app/services/content/drafts';
import { SiteSettingsForm } from '@/components/admin/SiteSettingsForm';
import { isOnlineBookingLockedForPayments } from '@/app/lib/online-booking-lock';
import { BilingualContentEditor } from '@/components/admin/BilingualContentEditor';
import { getT } from '@/i18n/server';
import { rich } from '@/i18n/rich';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [settings, t] = await Promise.all([getSiteSettings(), getT('adminContent')]);
  // The settings row is created on first read above; if the database was
  // unreachable the hero editor is left out rather than failing the page.
  const hero = await prisma.$transaction((tx) => getEditorState(tx, 'SITE_SETTINGS', 'singleton')).catch((error: unknown) => {
    console.error('Failed to load the hero editor:', error);
    return null;
  });
  // Everything but the hero text, which only the bilingual editor below writes.
  const operational = {
    phone: settings.phone,
    twitterHandle: settings.twitterHandle,
    gscVerification: settings.gscVerification,
    googleBusinessUrl: settings.googleBusinessUrl,
    facebookUrl: settings.facebookUrl,
    instagramUrl: settings.instagramUrl,
    treatwellUrl: settings.treatwellUrl,
    freshaUrl: settings.freshaUrl,
    booksyUrl: settings.booksyUrl,
    bookingEnabled: settings.bookingEnabled,
    salonNotificationLocale: settings.salonNotificationLocale,
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('settings.title')}</h1>
        <p className="text-zinc-700 mt-2">
          {rich(t('settings.intro'), {
            link: (text) => (
              <Link href="/" className="underline hover:text-zinc-900">
                {text}
              </Link>
            ),
          })}
        </p>
      </div>
      <SiteSettingsForm settings={operational} bookingLockedForPayments={isOnlineBookingLockedForPayments()} />

      <section className="mt-10 space-y-4" aria-labelledby="home-hero-title">
        <div>
          <h2 id="home-hero-title" className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('settings.hero.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.hero.help')}</p>
        </div>
        {hero ? (
          <BilingualContentEditor
            mode="edit"
            type="SITE_SETTINGS"
            entityId="singleton"
            initial={{
              revision: hero.revision,
              working: hero.working,
              review: hero.review,
              shared: hero.shared,
              hasDraft: hero.hasDraft,
              draftUpdatedAt: hero.draftUpdatedAt,
            }}
          />
        ) : (
          <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{t('settings.hero.unavailable')}</p>
        )}
      </section>
    </div>
  );
}
