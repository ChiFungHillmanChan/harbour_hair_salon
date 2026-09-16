import { verifySession } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { AppointmentCard } from '@/components/appointments/AppointmentCard';
import { isBookingEnabled } from '@/app/lib/booking-maintenance';
import { pageNumber } from '@/app/lib/pagination';
import { Pagination } from '@/components/admin/Pagination';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Bookings | Harbour Hair Salon',
  description: 'View, cancel, or reschedule your hair appointments.',
  robots: { index: false, follow: false },
};

export default async function AppointmentsPage({ searchParams }: { searchParams?: Promise<{ page?: string; upcoming?: string }> }) {
  const session = await verifySession();
  const query = await searchParams;
  const page = pageNumber(query?.page);
  const upcomingPage = pageNumber(query?.upcoming);
  const now = new Date();
  const select = {
    id: true, date: true, status: true, stylistId: true, serviceId: true,
    priceAtBooking: true, durationAtBooking: true,
    stylist: { select: { name: true } },
    service: { select: { name: true, price: true, duration: true } },
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

  const serialize = (appts: typeof upcomingRows) =>
    appts.map(a => ({
      id: a.id,
      date: a.date.toISOString(),
      status: a.status,
      stylistId: a.stylistId,
      stylist: a.stylist,
      serviceId: a.serviceId,
      service: {
        name: a.service.name,
        price: Number(a.priceAtBooking ?? a.service.price),
        duration: a.durationAtBooking ?? a.service.duration,
      },
      hasReview: Boolean(a.review),
    }));

  return (
    <div className="min-h-screen bg-zinc-50 py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-4xl font-serif mb-8 text-zinc-900">My Bookings</h1>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-zinc-800 mb-4">Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="text-zinc-500">No upcoming appointments.</p>
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
          <h2 className="text-2xl font-semibold text-zinc-800 mb-4">Past</h2>
          {past.length === 0 ? (
            <p className="text-zinc-500">No past appointments.</p>
          ) : (
            <div className="space-y-4">
              {serialize(past).map(a => (
                <AppointmentCard key={a.id} appointment={a} isUpcoming={false} bookingEnabled={bookingEnabled} />
              ))}
            </div>
          )}
          <Pagination path="/appointments" page={page} hasMore={pastRows.length > 25} query={{ upcoming: String(upcomingPage) }} />
        </section>
      </div>
    </div>
  );
}
