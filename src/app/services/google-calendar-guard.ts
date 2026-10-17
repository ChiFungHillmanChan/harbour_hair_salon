import 'server-only';

// Calendar change guard (docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §8).

import type { PrismaClient } from '@prisma/client';

const STATE_ID = 'singleton';
type GuardDb = Pick<PrismaClient, 'googleCalendarSyncState' | 'googleCalendarEvent' | '$transaction'>;

/**
 * The GoogleCalendarEvent rows describe events in ONE calendar: the one
 * recorded in GoogleCalendarSyncState.calendarId. When the configured calendar
 * differs, or none was recorded yet (the first run after this shipped), the
 * rows prove nothing about the configured calendar, so they are deleted with
 * the watch channel: the next push writes every booking in the window there,
 * and the next daily run (or Sync now) watches it. Events in the old calendar
 * are never deleted (the owner removes that calendar by hand). Conditional,
 * so of two racing callers only one clears.
 */
export async function guardGoogleCalendarChange(db: GuardDb, calendarId: string): Promise<'same' | 'switched'> {
  const state = await db.googleCalendarSyncState.findUnique({ where: { id: STATE_ID }, select: { calendarId: true } });
  if (state?.calendarId === calendarId) return 'same';
  const reset = { calendarId, channelId: null, resourceId: null, channelExpiresAt: null };
  const outcome = await db.$transaction(async (tx) => {
    if (state) {
      const { count } = await tx.googleCalendarSyncState.updateMany({
        where: { id: STATE_ID, OR: [{ calendarId: null }, { calendarId: { not: calendarId } }] },
        data: reset,
      });
      if (count === 0) return 'same' as const;
    } else {
      await tx.googleCalendarSyncState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, ...reset }, update: reset });
    }
    await tx.googleCalendarEvent.deleteMany({});
    return 'switched' as const;
  });
  if (outcome === 'switched') console.info('Google Calendar: the configured calendar changed; every booking is written there afresh.');
  return outcome;
}
