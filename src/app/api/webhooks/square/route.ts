import { after } from 'next/server';
import { usableSquareConfig } from '@/app/lib/online-booking-lock';
import { readCappedBody, verifySquareWebhookSignature } from '@/app/lib/square-webhook';
import { describeFault } from '@/app/lib/fault';
import {
  isForeignSquareEvent, parseSquareWebhookEvent, recordSquareWebhookEvent, SQUARE_WEBHOOK_MAX_BYTES,
} from '@/app/services/square-webhook-events';

// Square's payment and refund notifications (docs/square-payments-setup.md §1.7).
// Square calls this whenever money moves on the salon's account — not only
// for this site's deposits — so everything that can be refused is refused
// before the database is touched (CLAUDE.md, "Neon compute budget": a public
// endpoint something external calls is a cron you do not control):
//   1. no usable Square configuration (switched off, incomplete, sandbox
//      credentials in a production build, or production credentials on a
//      preview or in development) ⇒ 404: the route does not exist;
//   2. a body over 64 KB ⇒ 413; a signature that does not match the
//      configured key and the configured notification URL — never this
//      request's Host — ⇒ 401;
//   3. an event type this site does not act on, or one that cannot be about
//      its deposits (another location — a payment, a refund, or an event the
//      schema cannot read that names one — or a payment without a deposit
//      reference) ⇒ 200, ignored.
// Only then is the event stored once and applied (services/square-webhook-events.ts):
// payment rows move forward, bookings never change; a refund whose payment is
// none of this site's deposits (an in-salon refund) is settled at once
// (NOT_OURS: never listed, never re-read). When Square may hold or
// have taken money no booking wants, it is asked afresh AFTER this answer has
// gone (payment-reconciliation.ts), outside any transaction — so Square, which
// waits 10 seconds and retries anything but a 2xx for a day, always hears back
// fast. Every answer is an empty body; logs carry names and codes only.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The answer goes within a second or two; the follow-up check after it may
// make two Square calls of up to 10 seconds each.
export const maxDuration = 30;

const answer = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  // Read per request, never at module load: it carries the access token.
  const config = usableSquareConfig();
  if (!config) return answer(404);

  let body: string | null;
  try {
    body = await readCappedBody(request, SQUARE_WEBHOOK_MAX_BYTES);
  } catch {
    return answer(400);
  }
  if (body === null) return answer(413);
  const signed = verifySquareWebhookSignature({
    body,
    signature: request.headers.get('x-square-hmacsha256-signature'),
    signatureKey: config.webhookSignatureKey,
    notificationUrl: config.webhookNotificationUrl,
  });
  if (!signed) return answer(401);

  const event = parseSquareWebhookEvent(body);
  if (event === null) return answer(400);
  if (event === 'IGNORED' || isForeignSquareEvent(event, config)) return answer(200);

  try {
    const { default: prisma } = await import('@/app/lib/prisma');
    const outcome = await recordSquareWebhookEvent(prisma, config, event, new Date());
    if (outcome === 'CHECK') {
      // Recorded (still open) before anything is asked of Square; if this
      // does not finish, the daily reconciliation does it.
      after(async () => {
        try {
          const { reconcileSquareEvent } = await import('@/app/services/payment-reconciliation');
          await reconcileSquareEvent(event.eventId);
        } catch (error) {
          console.error('Square webhook follow-up failed', { type: event.type, ...describeFault(error) });
        }
      });
    }
    return answer(200);
  } catch (error) {
    // Not recorded (or not fully applied): Square delivers it again.
    console.error('Square webhook could not be recorded', { type: event.type, ...describeFault(error) });
    return answer(500);
  }
}
