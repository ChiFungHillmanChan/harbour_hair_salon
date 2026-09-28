import { verifySession } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { OG_BASE } from '@/app/lib/og-defaults';
import { AppointmentCard, type BookedPrice } from '@/components/appointments/AppointmentCard';
import { isBookingEnabled } from '@/app/lib/booking-maintenance';
import { pageNumber } from '@/app/lib/pagination';
import { recordedPrice } from '@/app/services/pricing/recorded-price';
import { loadPublishedTranslations, overlay } from '@/app/services/content/translations';
import { Pagination } from '@/components/admin/Pagination';
import { ClientMessages } from '@/i18n/ClientMessages';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('appointments')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/appointments'),
    robots: { index: false, follow: false },
    openGraph: { ...OG_BASE, ...ogLocale(locale), title: t('meta.title'), description: t('meta.description') },
  };
}

export default async function AppointmentsPage({ searchParams }: { searchParams?: Promise<{ page?: string; upcoming?: string }> }) {
  const session = await verifySession();
  const [locale, t] = await Promise.all([getLocale(), getT('appointments')]);
  const query = await searchParams;
  const page = pageNumber(query?.page);
  const upcomingPage = pageNumber(query?.upcoming);
  const now = new Date();
  // No live service price: a booking shows what was recorded when it was made.
  const select = {
    id: true, date: true, status: true, stylistId: true, serviceId: true,
    priceAtBooking: true, quoteJson: true, durationAtBooking: true,
    stylist: { select: { name: true } },
    service: { select: { name: true, duration: true } },
    review: { select: { id: true } },
  } as const;
  const [bookingEnabled, upcomingRows, pastRows] = await Promise.all([
    isBookingEnabled(),
    prisma.appointment.findMany({
      where: { userId: session.userId, date: { gte: now }, status: { in: ['CONFIRMED', 'PENDING'] } },
      select, orderBy: [{ date: 'asc' }, { id: 'asc' }], take: 26, skip: (upcomingPage - 1) * 25,
    }),
    prisma.appointment.findMany({
      where: { userId: session.userId, OR: [{ date: { lt: now } }, { status: { in: ['CANCELLED', 'COMPLETED'] } }] },
      select, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 26, skip: (page - 1) * 25,
    }),
  ]);
  const upcoming = upcomingRows.slice(0, 25);
  const past = pastRows.slice(0, 25);
  // Published service names in this language (none needed, and no query, in English).
  const serviceNames = await loadPublishedTranslations(prisma, 'SERVICE', [...upcoming, ...past].map((a) => a.serviceId), locale);

  const serialize = (appts: typeof upcomingRows) =>
    appts.map(a => {
      const booked = recordedPrice(a);
      // Only the display facts of the recorded quote reach the browser.
      const price: BookedPrice = booked.known
        ? { known: true, amountPence: booked.amountPence, priceType: booked.priceType, vatDisplay: booked.vatDisplay, priceNature: booked.priceNature }
        : { known: false };
      const { name, translated } = overlay({ name: a.service.name }, serviceNames.get(a.serviceId), ['name']);
      return {
        id: a.id,
        date: a.date.toISOString(),
        status: a.status,
        stylistId: a.stylistId,
        stylist: a.stylist,
        serviceId: a.serviceId,
        service: {
          name,
          nameIsEnglish: locale !== 'en-GB' && !translated,
          duration: a.durationAtBooking ?? a.service.duration,
        },
        price,
        hasReview: Boolean(a.review),
      };
    });

  return (
    <div className="min-h-screen bg-zinc-50 py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-4xl font-serif mb-8 text-zinc-900">{t('title')}</h1>

        <ClientMessages namespaces={['appointments', 'pricing']}>
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-zinc-800 mb-4">{t('upcoming.heading')}</h2>
            {upcoming.length === 0 ? (
              <p className="text-zinc-500">{t('upcoming.empty')}</p>
            ) : (
              <div className="space-y-4">
                {serialize(upcoming).map(a => (
                  <AppointmentCard key={a.id} appointment={a} isUpcoming bookingEnabled={bookingEnabled} />
                ))}
              </div>
            )}
            <Pagination path="/appointments" page={upcomingPage} pageKey="upcoming" hasMore={upcomingRows.length > 25} query={{ page: String(page) }} />
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-800 mb-4">{t('past.heading')}</h2>
            {past.length === 0 ? (
              <p className="text-zinc-500">{t('past.empty')}</p>
            ) : (
              <div className="space-y-4">
                {serialize(past).map(a => (
                  <AppointmentCard key={a.id} appointment={a} isUpcoming={false} bookingEnabled={bookingEnabled} />
                ))}
              </div>
            )}
            <Pagination path="/appointments" page={page} hasMore={pastRows.length > 25} query={{ upcoming: String(upcomingPage) }} />
          </section>
        </ClientMessages>
      </div>
    </div>
  );
}
