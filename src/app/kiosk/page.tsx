import { getKioskRoster } from '@/app/actions/kiosk';
import KioskClock from '@/components/kiosk/KioskClock';

export const dynamic = 'force-dynamic';

export default async function KioskPage() {
  const roster = await getKioskRoster();
  return (
    <main className="min-h-screen bg-zinc-900 text-white p-8">
      <h1 className="font-serif text-3xl mb-8 text-center">Staff Clock-In</h1>
      <KioskClock roster={roster} />
    </main>
  );
}
