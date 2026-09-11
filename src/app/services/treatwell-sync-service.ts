import { syncCalendarFeeds, type CalendarSyncDependencies, type CalendarSyncResult } from './calendar-sync-service';

export type SyncResult = CalendarSyncResult;
/** Legacy manual/cron entry point, sharing the same leases and safe transport. */
export async function syncTreatwellFeeds(deps: CalendarSyncDependencies = {}): Promise<SyncResult[]> {
  return syncCalendarFeeds({ ...deps, provider: 'TREATWELL' });
}
