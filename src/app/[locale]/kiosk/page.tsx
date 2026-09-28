import type { Metadata } from 'next';
import { getKioskRoster } from '@/app/actions/kiosk';
import KioskClock from '@/components/kiosk/KioskClock';
import { ClientMessages } from '@/i18n/ClientMessages';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('kiosk');
  return { title: t('meta.title'), robots: { index: false, follow: false } };
}

export default async function KioskPage() {
  const [roster, t] = await Promise.all([getKioskRoster(), getT('kiosk')]);
  return (
    <main className="min-h-screen bg-zinc-900 text-white p-8">
      {/* The kiosk language is a device preference: switching only changes
          this device's URL and remembered choice, never an employee record. */}
      <ClientMessages namespaces={['kiosk']}>
        <div className="flex justify-end -mt-4 mb-4">
          <LanguageSwitcher />
        </div>
        <h1 className="font-serif text-3xl mb-8 text-center">{t('title')}</h1>
        <KioskClock roster={roster} />
      </ClientMessages>
    </main>
  );
}
