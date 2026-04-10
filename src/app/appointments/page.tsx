import { verifySession } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { AppointmentCard } from '@/components/appointments/AppointmentCard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Bookings | Harbour Hair Salon',
  description: 'View, cancel, or reschedule your hair appointments.',
  robots: { index: false, follow: false },
};

export default async function AppointmentsPage() {
  const session = await verifySession();

  const appointments = await prisma.appointment.findMany({
    where: { userId: session.userId },
    include: {
      stylist: true,
      service: true,
      review: { select: { id: true } },
    },
    orderBy: { date: 'desc' },
  });

  const now = new Date();
  const upcoming = appointments
    .filter(a => a.date >= now && a.status === 'CONFIRMED')
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const past = appointments
    .filter(a => a.date < now || a.status === 'CANCELLED' || a.status === 'COMPLETED');

  const serialize = (appts: typeof appointments) =>
    appts.map(a => ({
      ...a,
      date: a.date.toISOString(),
      service: { ...a.service, price: Number(a.service.price) },
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
                <AppointmentCard key={a.id} appointment={a} isUpcoming />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-zinc-800 mb-4">Past</h2>
          {past.length === 0 ? (
            <p className="text-zinc-500">No past appointments.</p>
          ) : (
            <div className="space-y-4">
              {serialize(past).map(a => (
                <AppointmentCard key={a.id} appointment={a} isUpcoming={false} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
