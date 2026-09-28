import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { OpeningHoursForm, type StylistWeek } from '@/components/admin/OpeningHoursForm';
import { isBookingEnabled } from '@/app/lib/booking-maintenance';
import { getT } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('adminSchedule');
  return { title: t('openingHours.metaTitle') };
}

/** Availability is read per request and changes on save, so never cache it. */
export const dynamic = 'force-dynamic';

/**
 * A stylist may have fewer than seven Availability rows (or none — the seed is
 * the only thing that has ever written them). The editor always submits a full
 * week, so pad the gaps here with a closed day rather than letting the form
 * render holes.
 */
function toWeek(rows: { dayOfWeek: number; isOff: boolean; startTime: string; endTime: string }[]) {
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
    const row = rows.find((r) => r.dayOfWeek === dayOfWeek);
    return row ?? { dayOfWeek, isOff: true, startTime: '10:00', endTime: '19:00' };
  });
}

export default async function OpeningHoursPage() {
  await requireAdmin();
  const [stylists, bookingEnabled, t] = await Promise.all([
    prisma.stylist.findMany({
      // Retired stylists are not bookable, so they have no hours to edit.
      where: { isActive: true },
      orderBy: { name: 'asc' },
      // Explicit select: the full Stylist row carries the secret
      // treatwellIcalUrl / icalToken, which must not reach a client component.
      select: {
        id: true,
        name: true,
        availabilities: {
          select: { dayOfWeek: true, isOff: true, startTime: true, endTime: true },
        },
      },
    }),
    isBookingEnabled(),
    getT('adminSchedule'),
  ]);

  const weeks: StylistWeek[] = stylists.map((s) => ({
    id: s.id,
    name: s.name,
    days: toWeek(s.availabilities),
  }));

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-zinc-900 sm:text-3xl">{t('openingHours.title')}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-600">
          {t('openingHours.intro')}
        </p>
      </div>

      <OpeningHoursForm stylists={weeks} bookingEnabled={bookingEnabled} />
    </div>
  );
}
