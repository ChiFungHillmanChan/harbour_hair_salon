import { after } from 'next/server';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { channelTokenMatches } from '@/app/lib/google-channel-token';
import { describeFault } from '@/app/lib/fault';

// Google Calendar push notifications
// (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §6).
// Google calls this for every change on the salon calendar, the website's own
// writes included: a public endpoint something external calls is a cron you
// do not control (CLAUDE.md, "Neon compute budget"), so everything that can be
// refused is refused before the database is touched:
//   1. sync off (not configured, or a preview deployment) ⇒ 404;
//   2. X-Goog-Channel-Token not signed under the webhook secret for
//      X-Goog-Channel-ID, or past the expiry it carries (lib/google-channel-token.ts) ⇒ 401;
//   3. X-Goog-Resource-State "sync" (the handshake when a channel is created) ⇒ 200, nothing else.
// Any other notification is answered 200 at once and the calendar is pulled
// after the answer, single-flight: a burst of notifications runs one pull at a
// time plus one re-run (services/google-calendar-channel.ts). Google sends no
// body and the route reads none. It only ever PULLS: pushing from here would
// bring another notification, and another pull, without end.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The answer goes at once; the pull after it lists Google (up to ten pages,
// ten seconds each at worst) and stops starting write-backs after 40 seconds.
export const maxDuration = 90;

const answer = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  // Read per request, never at module load: it carries the webhook secret.
  const config = googleCalendarConfig();
  if (!config) return answer(404);

  const channelId = request.headers.get('x-goog-channel-id');
  const token = request.headers.get('x-goog-channel-token');
  if (!channelId || !token || !channelTokenMatches(config.webhookSecret, channelId, token)) return answer(401);

  if (request.headers.get('x-goog-resource-state') === 'sync') return answer(200);

  after(async () => {
    try {
      // Imported here, after the answer: nothing above opens the database.
      const [{ runPullSingleFlight }, { pullGoogleCalendar }] = await Promise.all([
        import('@/app/services/google-calendar-channel'),
        import('@/app/services/google-calendar-pull'),
      ]);
      await runPullSingleFlight(() => pullGoogleCalendar());
    } catch (error) {
      // The pull records its own failures; this is the lock or an import.
      console.error('Google Calendar notification pull failed', describeFault(error));
    }
  });
  return answer(200);
}
