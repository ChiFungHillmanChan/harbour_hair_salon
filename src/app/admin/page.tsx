import Link from 'next/link';
import prisma from '@/app/lib/prisma';
import { ScheduleCalendar } from '@/components/admin/ScheduleCalendar';
import { getTreatwellSyncCoverage } from '@/app/services/integration-readiness';
import { startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { Suspense } from 'react';

export default function AdminDashboard() {
  // The static header renders (and paints) immediately; the appointment data
  // and calendar stream in behind Suspense, so LCP no longer waits on Neon.
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">Schedule</h1>
        <p className="text-zinc-700 mt-2">Manage appointments and availability.</p>
      </div>

      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleContent />
      </Suspense>
    </div>
  );
}

async function ScheduleContent() {
  const now = new Date();

  // Only fetch 3 months of data (previous month, current, next)
  const rangeStart = startOfMonth(subMonths(now, 1));
  const rangeEnd = endOfMonth(addMonths(now, 1));

  const [appointments, todayStats, syncCoverage] = await Promise.all([
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
    getTreatwellSyncCoverage(),
  ]);

  const todayConfirmed = todayStats.find(s => s.status === 'CONFIRMED')?._count ?? 0;
  const todayCancelled = todayStats.find(s => s.status === 'CANCELLED')?._count ?? 0;
  // Double-confirm flow: booking requests arrive as PENDING and need approval.
  const pendingCount = appointments.filter(a => a.status === 'PENDING').length;

  return (
    <>
      {/* Surfaced here (not only on /admin/integrations) because this is the
          page the salon actually opens every day. */}
      {syncCoverage.warning && (
        <div
          role="alert"
          className="mb-6 rounded-lg border-2 border-red-300 bg-red-50 px-5 py-4 text-sm text-red-900"
        >
          <p className="font-semibold uppercase tracking-wide text-xs text-red-700">
            Double-booking risk
          </p>
          <p className="mt-2 leading-6">{syncCoverage.warning}</p>
          <Link href="/admin/integrations" className="mt-2 inline-block font-semibold underline">
            Fix in Integrations →
          </Link>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className={`p-5 rounded-lg shadow border ${pendingCount > 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-zinc-200'}`}>
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">Awaiting Confirmation</p>
          <p className={`text-3xl font-bold mt-1 ${pendingCount > 0 ? 'text-amber-700' : 'text-zinc-900'}`}>{pendingCount}</p>
        </div>
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
    </>
  );
}

function ScheduleSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading schedule">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white p-5 rounded-lg shadow border border-zinc-200">
            <div className="h-4 w-24 rounded bg-zinc-200" />
            <div className="mt-3 h-8 w-12 rounded bg-zinc-200" />
          </div>
        ))}
      </div>
      <div className="h-96 rounded-lg border border-zinc-200 bg-white shadow" />
    </div>
  );
}
