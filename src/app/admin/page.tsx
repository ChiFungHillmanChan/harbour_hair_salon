import prisma from '@/app/lib/prisma';
import { ScheduleCalendar } from '@/components/admin/ScheduleCalendar';
import { startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';

export default async function AdminDashboard() {
  const now = new Date();

  // Only fetch 3 months of data (previous month, current, next)
  const rangeStart = startOfMonth(subMonths(now, 1));
  const rangeEnd = endOfMonth(addMonths(now, 1));

  const [appointments, todayStats] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        date: {
          gte: rangeStart,
          lte: rangeEnd,
        },
      },
      include: {
        // Only the fields the calendar renders — avoids shipping full stylist
        // rows (incl. treatwellIcalUrl) and service descriptions to the client.
        user: { select: { id: true, name: true, email: true } },
        stylist: { select: { name: true } },
        service: { select: { name: true, duration: true, price: true } },
      },
      orderBy: { date: 'asc' },
    }),
    // Quick stats for today
    prisma.appointment.groupBy({
      by: ['status'],
      where: {
        date: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
        },
      },
      _count: true,
    }),
  ]);

  const todayConfirmed = todayStats.find(s => s.status === 'CONFIRMED')?._count ?? 0;
  const todayCancelled = todayStats.find(s => s.status === 'CANCELLED')?._count ?? 0;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-zinc-900">Schedule</h1>
        <p className="text-zinc-700 mt-2">Manage appointments and availability.</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">Today&apos;s Bookings</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{todayConfirmed}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">Cancellations Today</p>
          <p className="text-3xl font-bold text-red-600 mt-1">{todayCancelled}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">This Period</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{appointments.length}</p>
        </div>
      </div>

      <ScheduleCalendar appointments={appointments} />
    </div>
  );
}
