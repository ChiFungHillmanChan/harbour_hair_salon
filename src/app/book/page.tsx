import prisma from '@/app/lib/prisma';
import Image from 'next/image';
import { BookingWizard } from '@/components/booking/BookingWizard';
import { getAggregateRating } from '@/app/services/review-service';
import { redirect } from 'next/navigation';
import { isBookingEnabled, TREATWELL_BOOKING_URL } from '@/app/lib/booking-maintenance';
import { getSession } from '@/app/lib/session';
import { getSiteSettings } from '@/app/services/site-settings-service';

export const metadata = {
  title: 'Book Your Hair Appointment in Leeds',
  description: 'Book your next hair appointment online at Harbour Hair Salon, Leeds city centre. Choose your service, stylist and time.',
  alternates: { canonical: '/book' },
  robots: { index: false, follow: true },
  openGraph: {
    title: 'Book Your Appointment | Harbour Hair Salon Leeds',
    description: 'Book your next hair appointment online. Choose your service, stylist and time.',
  },
};

// Whether booking is open now lives in the database and the signed-in check
// moved here from middleware, so this route reads per-request state and cannot
// be ISR-cached. /book is robots-disallowed and low traffic, so the extra reads
// are negligible; SiteSettings itself is still cached (unstable_cache, 1h).
export const dynamic = 'force-dynamic';

async function getServices() {
  const services = await prisma.service.findMany({
    orderBy: { category: 'asc' },
  });
  
  // Convert Decimal to number for client components
  return services.map(service => ({
    ...service,
    price: Number(service.price)
  }));
}

async function getStylists() {
  // Only public-safe fields — the full row includes the secret treatwellIcalUrl,
  // which must never reach this client component / the RSC payload.
  return prisma.stylist.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true, imageUrl: true },
  });
}

export default async function BookPage() {
  if (!(await isBookingEnabled())) {
    // Phone and Treatwell URL come from SiteSettings so the salon can change
    // them from the admin panel without a redeploy.
    const settings = await getSiteSettings();
    const treatwellUrl = settings.treatwellUrl || TREATWELL_BOOKING_URL;

    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-16">
        <div className="max-w-xl w-full bg-white rounded-lg shadow border border-zinc-200 p-8 md:p-12 text-center">
          <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
          <h1 className="text-3xl md:text-4xl font-serif text-zinc-900 mb-4 tracking-tight">
            Online Booking Under Maintenance
          </h1>
          <p className="text-zinc-600 leading-relaxed mb-8">
            Our website booking system is temporarily under maintenance. You can still
            book by phone or through Treatwell. Thank you, and sorry for any
            inconvenience.
          </p>

          {/* Phone first and equally prominent: a phone booking costs the salon
              no marketplace commission, so it should never look like a fallback. */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={`tel:${settings.phone.replace(/\s+/g, '')}`}
              className="inline-block bg-zinc-900 text-white px-8 py-3 rounded-md font-medium hover:bg-zinc-700 transition-colors"
            >
              Call {settings.phone}
            </a>
            <a
              href={treatwellUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block border border-zinc-900 text-zinc-900 px-8 py-3 rounded-md font-medium hover:bg-zinc-100 transition-colors"
            >
              Book on Treatwell
            </a>
          </div>

          <p className="mt-6 text-sm text-zinc-500">
            Existing appointments can still be viewed and cancelled from{' '}
            <a href="/appointments" className="underline hover:text-zinc-900">
              My Appointments
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  // Booking is open — it requires an account, so send anonymous visitors to
  // sign in (this gate used to live in middleware).
  const session = await getSession();
  if (!session?.userId) {
    redirect('/auth/signin?redirect=/book');
  }

  const [services, stylists, aggregateRating] = await Promise.all([
    getServices(),
    getStylists(),
    getAggregateRating(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Hero Section */}
      <section className="relative py-14 md:py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/hero-salon.webp"
            alt="Book your appointment at Harbour Hair Salon Leeds"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-40"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-4xl md:text-6xl font-serif mb-6 tracking-tight">
            Book Your <span className="text-zinc-400">Appointment</span>
          </h1>
          <p className="text-base md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            Select your service, stylist, and preferred time.
          </p>
          {aggregateRating.count > 0 && (
            <p className="mt-6 inline-flex items-center gap-2 text-sm text-zinc-300">
              <span className="text-zinc-300" aria-hidden="true">★</span>
              <span className="font-semibold text-white">{aggregateRating.average.toFixed(1)}</span>
              <span aria-hidden="true">·</span>
              <span>{aggregateRating.count} verified reviews</span>
            </p>
          )}
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12">
        
        <BookingWizard services={services} stylists={stylists} />
      </div>
    </div>
  );
}
