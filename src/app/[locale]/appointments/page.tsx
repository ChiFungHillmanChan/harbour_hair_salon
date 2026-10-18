import { verifySession } from '@/app/lib/session';
import { EMAIL_VERIFICATION_SELECT, hasVerifiedEmail } from '@/app/lib/email-verification';
import { VerifyEmailResendForm } from '@/components/auth/VerifyEmailResendForm';
import prisma from '@/app/lib/prisma';
import { OG_BASE } from '@/app/lib/og-defaults';
import { AppointmentCard, type BookedPrice } from '@/components/appointments/AppointmentCard';
import { isBookingEnabledFor } from '@/app/lib/booking-maintenance';
import { rescheduleRequestView } from '@/app/lib/reschedule-request';
import { pageNumber } from '@/app/lib/pagination';
import { recordedPrice } from '@/app/services/pricing/recorded-price';
import { loadPublishedTranslations, overlay } from '@/app/services/content/translations';
import { appointmentCalendarEvent } from '@/app/services/appointment-calendar';
import { depositView, depositViewSelect } from '@/app/lib/deposit-display';
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

  // Bookings belong to whoever proved the address: staff attach phone bookings
  // to the account that holds the customer's email, and anyone can register
  // an address they do not own (security review 2026-10-16). As on /book, say
  // so up front with a way to get a new link.
  const account = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true, ...EMAIL_VERIFICATION_SELECT } });
  if (account && !hasVerifiedEmail(account)) {
    const ta = await getT('auth');
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-16">
        <div className="max-w-xl w-full bg-white rounded-lg shadow border border-zinc-200 p-8 md:p-12 text-center">
          <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
          <h1 className="text-3xl md:text-4xl font-serif text-zinc-900 mb-4 tracking-tight">{ta('verifyEmail.manageTitle')}</h1>
          <p className="text-zinc-600 leading-relaxed mb-8 break-words">{ta('verifyEmail.manageBody', { email: account.email })}</p>
          <ClientMessages sections={{ auth: ['verifyEmail'] }}>
            <VerifyEmailResendForm email={account.email} />
          </ClientMessages>
        </div>
      </div>
    );
  }
  const query = await searchParams;
  const page = pageNumber(query?.page);
  const upcomingPage = pageNumber(query?.upcoming);
  const now = new Date();
  // No live service price: a booking shows what was recorded when it was made.
  const select = {
    id: true, date: true, status: true, stylistId: true, serviceId: true,
    // Set when the salon cancelled the booking because the customer was late.
    lateCancelledAt: true,
    priceAtBooking: true, quoteJson: true, durationAtBooking: true,
    // The consultation credit recorded on the booking; its source and the treatment's own price are untouched.
    consultationCreditPence: true,
    // Moved at a request made inside 48 hours: cancelling keeps the deposit.
    depositLockedAt: true,
    stylist: { select: { name: true } },
    service: { select: { name: true, duration: true } },
    review: { select: { id: true } },
    rescheduleRequestedDate: true, rescheduleRequestedAt: true,
    // The calendar entry's SEQUENCE, so a downloaded file updates an older one.
    notificationVersion: true,
    // The card deposit's state (held, paid, refunded, …), never Square ids.
    paymentAttempt: { select: depositViewSelect },
  } as const;
  const [bookingEnabled, upcomingRows, pastRows] = await Promise.all([
    // Open to the public, or this account is a beta tester (lib/booking-maintenance.ts).
    isBookingEnabledFor(session.userId),
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
      const duration = a.durationAtBooking ?? a.service.duration;
      return {
        id: a.id,
        date: a.date.toISOString(),
        status: a.status,
        lateCancelled: a.lateCancelledAt != null,
        stylistId: a.stylistId,
        stylist: a.stylist,
        serviceId: a.serviceId,
        service: {
          name,
          nameIsEnglish: locale !== 'en-GB' && !translated,
          duration,
        },
        price,
        consultationCreditPence: a.consultationCreditPence,
        deposit: depositView(a.paymentAttempt),
        depositLocked: a.depositLockedAt != null,
        hasReview: Boolean(a.review),
        request: rescheduleRequestView(a, now),
        // Only a confirmed, upcoming time goes into the customer's own calendar;
        // a pending request is not agreed yet. Built from this row: no query.
        calendar: a.status === 'CONFIRMED' && a.date > now
          ? appointmentCalendarEvent({
              id: a.id, date: a.date, durationMinutes: duration,
              serviceName: name, stylistName: a.stylist.name, sequence: a.notificationVersion,
            }, locale)
          : null,
      };
    });

  return (
    <div className="min-h-screen bg-zinc-50 py-6 sm:py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-3xl sm:text-4xl font-serif mb-6 sm:mb-8 text-zinc-900">{t('title')}</h1>

        <ClientMessages namespaces={['appointments', 'pricing']}>
          <section className="mb-8 sm:mb-12">
            <h2 className="text-xl sm:text-2xl font-semibold text-zinc-800 mb-4">{t('upcoming.heading')}</h2>
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
            <h2 className="text-xl sm:text-2xl font-semibold text-zinc-800 mb-4">{t('past.heading')}</h2>
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
