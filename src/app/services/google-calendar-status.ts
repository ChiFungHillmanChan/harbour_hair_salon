import 'server-only';

// What Admin → Integrations shows about the Google Calendar sync
// (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §7–§8).
// Nothing secret leaves here: the calendar id is cut to its first characters,
// and the channel id, resource id and busy hash are never selected.

import type { PrismaClient } from '@prisma/client';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';

export type GoogleCalendarStatus =
  | { enabled: false }
  | {
      enabled: true;
      /** First 6 characters and an ellipsis. */
      calendarId: string;
      channelExpiresAt: Date | null;
      lastPullAt: Date | null;
      lastPullSuccessAt: Date | null;
      /** A catalogued sentence (`operations-messages.ts`) or older free text. */
      lastPullError: string | null;
      /** Bookings whose Google copy is failing (rows with a `lastError`). */
      failedEvents: number;
    };

type StatusDb = Pick<PrismaClient, 'googleCalendarSyncState' | 'googleCalendarEvent'>;

const MASK_LENGTH = 6;

/** With the sync off this answers before importing or querying the database. */
export async function getGoogleCalendarStatus(options: { db?: StatusDb; env?: NodeJS.ProcessEnv } = {}): Promise<GoogleCalendarStatus> {
  const config = googleCalendarConfig(options.env);
  if (!config) return { enabled: false };
  const db = options.db ?? (await import('@/app/lib/prisma')).default;
  const [state, failedEvents] = await Promise.all([
    db.googleCalendarSyncState.findUnique({
      where: { id: 'singleton' },
      select: { channelExpiresAt: true, lastPullAt: true, lastPullSuccessAt: true, lastPullError: true },
    }),
    db.googleCalendarEvent.count({ where: { lastError: { not: null } } }),
  ]);
  return {
    enabled: true,
    calendarId: `${config.calendarId.slice(0, MASK_LENGTH)}…`,
    channelExpiresAt: state?.channelExpiresAt ?? null,
    lastPullAt: state?.lastPullAt ?? null,
    lastPullSuccessAt: state?.lastPullSuccessAt ?? null,
    lastPullError: state?.lastPullError ?? null,
    failedEvents,
  };
}
