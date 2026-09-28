import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from '@/i18n/link';
import prisma from '@/app/lib/prisma';
import { loadPublishedTranslations } from '@/app/services/content/translations';
import { verifySession } from '@/app/lib/session';
import { ReviewForm } from '@/components/reviews/ReviewForm';
import { getLocale, getT } from '@/i18n/server';
import { ClientMessages } from '@/i18n/ClientMessages';
import { localizeHref } from '@/i18n/paths';
import { formatSalonLongDate } from '@/i18n/dates';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('reviews');
  return {
    title: t('new.meta.title'),
    description: t('new.meta.description'),
    robots: { index: false, follow: false },
  };
}

export default async function NewReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ appointmentId?: string }>;
}) {
  const now = new Date();
  const session = await verifySession();
  const { appointmentId } = await searchParams;
  const [locale, t] = await Promise.all([getLocale(), getT('reviews')]);

  if (!appointmentId) {
    redirect(localizeHref(locale, '/appointments'));
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      service: { select: { name: true } },
      stylist: { select: { name: true } },
      review: { select: { id: true } },
    },
  });

  if (!appointment || appointment.userId !== session.userId) {
    notFound();
  }

  // The booked service's published name in this language; English otherwise.
  const serviceName = (await loadPublishedTranslations(prisma, 'SERVICE', [appointment.serviceId], locale)).get(appointment.serviceId)?.name;
  const localizedService = typeof serviceName === 'string' && serviceName.trim() ? serviceName : null;

  if (appointment.review) {
    return (
      <div className="min-h-screen bg-white">
        <div className="container mx-auto px-4 py-20 max-w-2xl text-center">
          <h1 className="text-3xl md:text-4xl font-serif text-zinc-900 mb-4">
            {t('new.alreadySubmittedTitle')}
          </h1>
          <p className="text-zinc-600 font-light mb-8">
            {t('new.alreadySubmittedBody')}
          </p>
          <Link
            href="/appointments"
            className="inline-block bg-zinc-900 text-white px-10 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-black transition-all"
          >
            {t('new.backToBookings')}
          </Link>
        </div>
      </div>
    );
  }

  const isPast = appointment.date.getTime() < now.getTime();
  const isCancelled = appointment.status === 'CANCELLED';
  if (!isPast || isCancelled) {
    return (
      <div className="min-h-screen bg-white">
        <div className="container mx-auto px-4 py-20 max-w-2xl text-center">
          <h1 className="text-3xl md:text-4xl font-serif text-zinc-900 mb-4">
            {t('new.notReadyTitle')}
          </h1>
          <p className="text-zinc-600 font-light mb-8">
            {t('new.notReadyBody')}
          </p>
          <Link
            href="/appointments"
            className="inline-block bg-zinc-900 text-white px-10 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-black transition-all"
          >
            {t('new.backToBookings')}
          </Link>
        </div>
      </div>
    );
  }

  const dateFormatted = formatSalonLongDate(locale, appointment.date);

  return (
    <div className="min-h-screen bg-white">
      <section className="relative py-20 bg-zinc-900 text-white">
        <div className="container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-4xl md:text-5xl font-serif mb-4 tracking-tight">
            {t('new.titleStart')} <span className="text-zinc-300">{t('new.titleEnd')}</span>
          </h1>
          <p className="text-zinc-400 max-w-xl mx-auto font-light leading-relaxed">
            {t('new.subtitle')}
          </p>
        </div>
      </section>

      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-6 mb-10">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium mb-2">
            {t('new.yourAppointment')}
          </p>
          {/* Service names are stored in English. */}
          <p className="text-lg font-medium text-zinc-900" lang={locale === 'en-GB' || localizedService ? undefined : 'en'}>{localizedService ?? appointment.service.name}</p>
          <p className="text-zinc-600 mt-1">
            {t('new.withOn', { stylist: appointment.stylist.name, date: dateFormatted })}
          </p>
        </div>

        <ClientMessages namespaces={['reviews']}>
          <ReviewForm appointmentId={appointment.id} />
        </ClientMessages>
      </div>
    </div>
  );
}
