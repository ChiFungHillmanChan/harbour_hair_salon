import Link from 'next/link';
import prisma from '@/app/lib/prisma';
import { ScheduleCalendar } from '@/components/admin/ScheduleCalendar';
import { getTreatwellSyncCoverage } from '@/app/services/integration-readiness';
import { resolveAdminCalendarRange, type CalendarQuery } from '@/app/services/admin-calendar-range';
import { Suspense } from 'react';

export default function AdminDashboard({ searchParams }: { searchParams: Promise<CalendarQuery> }) {
  // The static header renders (and paints) immediately; the appointment data
  // and calendar stream in behind Suspense, so LCP no longer waits on Neon.
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">Schedule</h1>
        <p className="text-zinc-700 mt-2">Manage appointments and availability.</p>
      </div>

      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ScheduleContent({ searchParams }: { searchParams: Promise<CalendarQuery> }) {
  const now = new Date();
  const { dateStr, view, range } = resolveAdminCalendarRange(await searchParams, now);
  const todayRange = resolveAdminCalendarRange({ view: 'day' }, now).range;
  const include = {
    user: { select: { id: true, name: true, email: true } },
    stylist: { select: { name: true, calendarColor: true } },
    service: { select: { name: true, duration: true, price: true, calendarColor: true } },
  } as const;

  const [appointments, todayStats, syncCoverage, stylists, busyBlocks, pendingAppointments] = await Promise.all([
    prisma.appointment.findMany({
      where: { date: range },
      include,
      orderBy: { date: 'asc' },
    }),
    // Quick stats for today
    prisma.appointment.groupBy({
      by: ['status'],
      where: { date: todayRange },
      _count: true,
    }),
    getTreatwellSyncCoverage(),
    // Roster for the day grid's columns. Retired stylists are excluded — they
    // keep their past appointments but must not get a column to drop work into.
    prisma.stylist.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        calendarColor: true,
        availabilities: { select: { dayOfWeek: true, startTime: true, endTime: true, isOff: true } },
      },
    }),
    prisma.externalBusyBlock.findMany({
      where: { start: { lt: range.lt }, end: { gt: range.gte } },
      select: { id: true, stylistId: true, start: true, end: true },
    }),
    // Requests must stay actionable even when their date is outside the view.
    prisma.appointment.findMany({ where: { status: 'PENDING' }, include, orderBy: { date: 'asc' } }),
  ]);

  const todayConfirmed = todayStats.find(s => s.status === 'CONFIRMED')?._count ?? 0;
  const todayCancelled = todayStats.find(s => s.status === 'CANCELLED')?._count ?? 0;
  // Double-confirm flow: booking requests arrive as PENDING and need approval.
  const pendingCount = pendingAppointments.length;

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

      <ScheduleCalendar dateStr={dateStr} view={view} appointments={appointments} pendingAppointments={pendingAppointments} stylists={stylists} busyBlocks={busyBlocks} />
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
