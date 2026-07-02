import prisma from '@/app/lib/prisma';
import Image from 'next/image';
import { BookingWizard } from '@/components/booking/BookingWizard';
import { getAggregateRating } from '@/app/services/review-service';

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

// Revalidate frequently for booking page
export const revalidate = 60;

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
  const [services, stylists, aggregateRating] = await Promise.all([
    getServices(),
    getStylists(),
    getAggregateRating(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Hero Section */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
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
          <div className="w-12 h-[2px] bg-accent mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            Book Your <span className="italic text-zinc-400">Appointment</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            Select your service, stylist, and preferred time.
          </p>
          {aggregateRating.count > 0 && (
            <p className="mt-6 inline-flex items-center gap-2 text-sm text-zinc-300">
              <span className="text-accent" aria-hidden="true">★</span>
              <span className="font-semibold text-white">{aggregateRating.average.toFixed(1)}</span>
              <span aria-hidden="true">·</span>
              <span>{aggregateRating.count} verified reviews</span>
            </p>
          )}
        </div>
      </section>

      <div className="container mx-auto px-4 py-12">
        
        <BookingWizard services={services} stylists={stylists} />
      </div>
    </div>
  );
}
