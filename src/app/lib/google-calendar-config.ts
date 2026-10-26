import 'server-only';

// Google Calendar two-way sync (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §3).
// Production only: the preview database is a copy of production with real
// customers, so a preview must never write to the salon's calendar.

/** Contains credentials: never pass this object to a client component. */
export type GoogleCalendarConfig = { calendarId: string; clientEmail: string; privateKey: string; webhookSecret: string };

/** Vercel pulls Sensitive variables into builds as this literal, not the value. */
const PLACEHOLDER = '[SENSITIVE]';

function present(value: string | undefined): string | null {
  return value && value !== PLACEHOLDER ? value : null;
}

/**
 * The sync's configuration, or null when sync is off: the flag is not exactly
 * "true", the deployment is a preview, or any value is missing, blank or the
 * Sensitive placeholder. Reads the environment when called, never at import.
 */
export function googleCalendarConfig(env: NodeJS.ProcessEnv = process.env): GoogleCalendarConfig | null {
  if (env.GOOGLE_CALENDAR_SYNC_ENABLED !== 'true' || env.VERCEL_ENV === 'preview') return null;
  const calendarId = present(env.GOOGLE_CALENDAR_ID?.trim());
  const clientEmail = present(env.GOOGLE_CALENDAR_SA_EMAIL?.trim());
  // Pasted into a single-line variable the PEM keeps its newlines as "\n".
  const privateKey = present(env.GOOGLE_CALENDAR_SA_PRIVATE_KEY?.replace(/\\n/g, '\n').trim());
  const webhookSecret = present(env.GOOGLE_CALENDAR_WEBHOOK_SECRET?.trim());
  if (!calendarId || !clientEmail || !privateKey || !webhookSecret) return null;
  return { calendarId, clientEmail, privateKey, webhookSecret };
}

/**
 * The Fresha mirror's configuration (services/fresha-mirror.ts): the same
 * service account, writing to a SEPARATE calendar, GOOGLE_FRESHA_MIRROR_CALENDAR_ID,
 * that the salon shares with it. Null when the Google sync is off, the id is
 * unset, or it names the salon calendar itself: the pull reads that one, so it
 * would import the copies as the salon's own busy time and send them back to Fresha.
 */
export function freshaMirrorCalendarConfig(env: NodeJS.ProcessEnv = process.env): GoogleCalendarConfig | null {
  const base = googleCalendarConfig(env);
  const calendarId = present(env.GOOGLE_FRESHA_MIRROR_CALENDAR_ID?.trim());
  if (!base || !calendarId || calendarId.toLowerCase() === base.calendarId.toLowerCase()) return null;
  return { ...base, calendarId };
}
