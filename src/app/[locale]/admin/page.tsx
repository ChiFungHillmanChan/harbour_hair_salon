import { requireAdmin } from '@/app/lib/session';
import { getAdminCalendarData } from '@/app/services/admin-calendar-data';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { CalendarSetupNotice } from '@/components/admin/CalendarSetupNotice';
import { ScheduleCalendar } from '@/components/admin/ScheduleCalendar';
import { type CalendarQuery } from '@/app/services/admin-calendar-range';
import { getT } from '@/i18n/server';
import { Suspense } from 'react';
import { isOnlineBookingLockedForPayments } from '@/app/lib/online-booking-lock';

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<CalendarQuery & { pending?: string | string[] }> }) {
  await requireAdmin();
  const t = await getT('adminSchedule');
  // The static header renders (and paints) immediately; the appointment data
  // and calendar stream in behind Suspense, so LCP no longer waits on Neon.
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('page.title')}</h1>
        <p className="text-zinc-700 mt-2">{t('page.subtitle')}</p>
      </div>

      <Suspense fallback={<ScheduleSkeleton label={t('page.loading')} />}>
        <ScheduleContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ScheduleContent({ searchParams }: { searchParams: Promise<CalendarQuery & { pending?: string | string[] }> }) {
  const [calendar, settings, t] = await Promise.all([
    getAdminCalendarData(await searchParams),
    getSiteSettings(),
    getT('adminSchedule'),
  ]);
  const { dateStr, view, appointments, pendingAppointments, pendingCount, pendingNext,
    pendingHasPrevious, monthCounts, periodCount, todayStats, syncCoverage, stylists, busyBlocks,
    services } = calendar;

  const todayConfirmed = todayStats.find(s => s.status === 'CONFIRMED')?._count ?? 0;
  const todayCancelled = todayStats.find(s => s.status === 'CANCELLED')?._count ?? 0;
  // Double-confirm flow: booking requests arrive as PENDING and need approval.


  return (
    <>
      {/* Surfaced here (not only on /admin/integrations) because this is the
          page the salon actually opens every day. */}
      <CalendarSetupNotice
        coverage={syncCoverage}
        // Effective state: the Square lock keeps production closed whatever the setting says.
        bookingEnabled={settings.bookingEnabled && !isOnlineBookingLockedForPayments()}
        scheduledSyncEnabled={process.env.CALENDAR_SYNC_ENABLED === 'true'}
      />

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className={`p-5 rounded-lg shadow border ${pendingCount > 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-zinc-200'}`}>
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('stats.awaiting')}</p>
          <p className={`text-3xl font-bold mt-1 ${pendingCount > 0 ? 'text-amber-700' : 'text-zinc-900'}`}>{pendingCount}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('stats.today')}</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{todayConfirmed}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('stats.cancelledToday')}</p>
          <p className="text-3xl font-bold text-red-600 mt-1">{todayCancelled}</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow border border-zinc-200">
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('stats.period')}</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{periodCount}</p>
        </div>
      </div>

      <ScheduleCalendar loadedAt={calendar.loadedAt} dateStr={dateStr} view={view} appointments={appointments} pendingAppointments={pendingAppointments} stylists={stylists} busyBlocks={busyBlocks} services={services} monthCounts={monthCounts} pendingNext={pendingNext} pendingHasPrevious={pendingHasPrevious} />
    </>
  );
}

function ScheduleSkeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label={label}>
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
