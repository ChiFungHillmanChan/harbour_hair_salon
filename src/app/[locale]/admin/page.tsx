import { requireAdmin } from '@/app/lib/session';
import { getAdminCalendarData } from '@/app/services/admin-calendar-data';
import { getLateArrivalBoard } from '@/app/services/late-arrival-board';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { CalendarSetupNotice } from '@/components/admin/CalendarSetupNotice';
import { LateArrivalPanel } from '@/components/admin/LateArrivalPanel';
import { ScheduleCalendar } from '@/components/admin/ScheduleCalendar';
import { type CalendarQuery } from '@/app/services/admin-calendar-range';
import { getLocale, getT } from '@/i18n/server';
import { Suspense } from 'react';
import { isOnlineBookingLockedForPayments } from '@/app/lib/online-booking-lock';

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<CalendarQuery & { pending?: string | string[] }> }) {
  await requireAdmin();
  const t = await getT('adminSchedule');
  // The static header renders (and paints) immediately; the appointment data
  // and calendar stream in behind Suspense, so LCP no longer waits on Neon.
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-5 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-zinc-900">{t('page.title')}</h1>
        <p className="text-sm text-zinc-700 mt-2 sm:text-base">{t('page.subtitle')}</p>
      </div>

      <Suspense fallback={<ScheduleSkeleton label={t('page.loading')} />}>
        <ScheduleContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ScheduleContent({ searchParams }: { searchParams: Promise<CalendarQuery & { pending?: string | string[] }> }) {
  const locale = await getLocale();
  const [calendar, settings, t, arrivals] = await Promise.all([
    getAdminCalendarData(await searchParams, locale),
    getSiteSettings(),
    getT('adminSchedule'),
    getLateArrivalBoard(),
  ]);
  const { dateStr, view, appointments, pendingAppointments, pendingCount, pendingNext,
    pendingHasPrevious, monthCounts, periodCount, todayStats, syncCoverage, stylists, busyBlocks,
    diaryEntries, services, rescheduleRequests, rescheduleRequestCount } = calendar;

  const todayConfirmed = todayStats.find(s => s.status === 'CONFIRMED')?._count ?? 0;
  const todayCancelled = todayStats.find(s => s.status === 'CANCELLED')?._count ?? 0;
  // Double-confirm flow: booking requests arrive as PENDING and need approval.


  return (
    <>
      {/* Surfaced here (not only on /admin/integrations) because this is the
          page the salon actually opens every day. */}
      <CalendarSetupNotice
        coverage={syncCoverage}
        // Effective state: without Square production credentials the payments lock keeps production closed whatever the setting says.
        bookingEnabled={settings.bookingEnabled && !isOnlineBookingLockedForPayments()}
        scheduledSyncEnabled={process.env.CALENDAR_SYNC_ENABLED === 'true'}
      />

      {/* Counts remain website-only: imported diary entries are distinct sources. */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-xs font-semibold text-zinc-700">{t('stats.scope')}</h2>
        <p className="text-xs text-zinc-500">{t('stats.scopeHelp')}</p>
      </div>
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4 mb-5 sm:mb-8">
        <div className={`min-w-0 p-2 sm:p-5 rounded-lg border ${pendingCount > 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-zinc-200'}`}>
          <p className="min-h-7 text-balance text-[11px] leading-[14px] sm:min-h-10 sm:text-sm sm:leading-5 text-zinc-600 font-medium">{t('stats.awaiting')}</p>
          <p className={`text-xl leading-6 sm:text-3xl font-bold mt-1 ${pendingCount > 0 ? 'text-amber-700' : 'text-zinc-900'}`}>{pendingCount}</p>
        </div>
        <div className={`min-w-0 p-2 sm:p-5 rounded-lg border ${rescheduleRequestCount > 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-zinc-200'}`}>
          <p className="min-h-7 text-balance text-[11px] leading-[14px] sm:min-h-10 sm:text-sm sm:leading-5 text-zinc-600 font-medium">{t('rescheduleRequests.stat')}</p>
          <p className={`text-xl leading-6 sm:text-3xl font-bold mt-1 ${rescheduleRequestCount > 0 ? 'text-amber-700' : 'text-zinc-900'}`}>{rescheduleRequestCount}</p>
        </div>
        <div className="bg-white min-w-0 p-2 sm:p-5 rounded-lg border border-zinc-200">
          <p className="min-h-7 text-balance text-[11px] leading-[14px] sm:min-h-10 sm:text-sm sm:leading-5 text-zinc-600 font-medium">{t('stats.today')}</p>
          <p className="text-xl leading-6 sm:text-3xl font-bold text-zinc-900 mt-1">{todayConfirmed}</p>
        </div>
        <div className="bg-white min-w-0 p-2 sm:p-5 rounded-lg border border-zinc-200">
          <p className="min-h-7 text-balance text-[11px] leading-[14px] sm:min-h-10 sm:text-sm sm:leading-5 text-zinc-600 font-medium">{t('stats.cancelledToday')}</p>
          <p className="text-xl leading-6 sm:text-3xl font-bold text-red-600 mt-1">{todayCancelled}</p>
        </div>
        <div className="bg-white min-w-0 p-2 sm:p-5 rounded-lg border border-zinc-200">
          <p className="min-h-7 text-balance text-[11px] leading-[14px] sm:min-h-10 sm:text-sm sm:leading-5 text-zinc-600 font-medium">{t('stats.period')}</p>
          <p className="text-xl leading-6 sm:text-3xl font-bold text-zinc-900 mt-1">{periodCount}</p>
        </div>
      </div>

      <LateArrivalPanel board={arrivals} />

      <ScheduleCalendar loadedAt={calendar.loadedAt} dateStr={dateStr} view={view} appointments={appointments} pendingAppointments={pendingAppointments} rescheduleRequests={rescheduleRequests} stylists={stylists} busyBlocks={busyBlocks} diaryEntries={diaryEntries} services={services} monthCounts={monthCounts} pendingNext={pendingNext} pendingHasPrevious={pendingHasPrevious} />
    </>
  );
}

function ScheduleSkeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label={label}>
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4 mb-5 sm:mb-8">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white min-w-0 p-2 sm:p-5 rounded-lg border border-zinc-200">
            <div className="h-7 w-full max-w-24 rounded bg-zinc-200 sm:h-10" />
            <div className="mt-1 h-6 w-10 rounded bg-zinc-200 sm:h-8 sm:w-12" />
          </div>
        ))}
      </div>
      <div className="h-96 rounded-lg border border-zinc-200 bg-white shadow" />
    </div>
  );
}
