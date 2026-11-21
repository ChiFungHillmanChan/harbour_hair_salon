'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { appendAuditEvent } from '@/app/lib/audit';
import { CARD_CHECK_FAILURE_KINDS, CARD_CHECK_LIMITS, scrubCardCheckText } from '@/app/lib/card-check-report';
import { cardCheckReportLimiter } from '@/app/lib/rate-limit';
import { getSession, isSessionCurrent } from '@/app/lib/session';

const short = z.string().max(CARD_CHECK_LIMITS.short).optional();
const list = z.string().max(CARD_CHECK_LIMITS.list).optional();
const reportSchema = z.object({
  kind: z.enum(CARD_CHECK_FAILURE_KINDS),
  environment: z.enum(['sandbox', 'production']).optional(),
  status: short,
  errorTypes: list,
  fields: list,
  errorKind: short,
  detail: z.string().max(CARD_CHECK_LIMITS.detail).optional(),
  directive: short,
  blockedOrigin: list,
}).strict();

/**
 * The booking page's card step failed in the browser (lib/card-check-report.ts):
 * record it, so staff and the developer can see why a customer could not book.
 * Square refuses or fails a card before submitBooking is ever called, so this
 * is the only trace such a failure leaves. Written as a log line (Vercel) and
 * an audit event (Admin → Operations → audit, `BOOKING.CARD_CHECK_FAILED`).
 *
 * Public like every Server Action: only a current signed-in session counts
 * (the card step is only shown to one), each account has a small hourly
 * budget, every field is re-validated and scrubbed again here, and it never
 * answers anything — a refused or failed report is dropped silently.
 */
export async function reportCardCheckFailure(input: unknown): Promise<void> {
  try {
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) return;
    // Cookie only first: a signed-out caller costs no lookup at all.
    const session = await getSession();
    if (!session?.userId) return;
    if (!(await cardCheckReportLimiter.check(`user:${session.userId}`))) return;
    if (!(await isSessionCurrent(session))) return;

    const report = parsed.data;
    const browser = scrubCardCheckText((await headers()).get('user-agent'), CARD_CHECK_LIMITS.list);
    const metadata = {
      kind: report.kind,
      environment: report.environment ?? null,
      status: scrubCardCheckText(report.status, CARD_CHECK_LIMITS.short) ?? null,
      errorTypes: scrubCardCheckText(report.errorTypes, CARD_CHECK_LIMITS.list) ?? null,
      fields: scrubCardCheckText(report.fields, CARD_CHECK_LIMITS.list) ?? null,
      errorKind: scrubCardCheckText(report.errorKind, CARD_CHECK_LIMITS.short) ?? null,
      detail: scrubCardCheckText(report.detail) ?? null,
      directive: scrubCardCheckText(report.directive, CARD_CHECK_LIMITS.short) ?? null,
      blockedOrigin: scrubCardCheckText(report.blockedOrigin, CARD_CHECK_LIMITS.list) ?? null,
      browser: browser ?? null,
    };
    console.warn('[card-check] booking card step failed', { userId: session.userId, ...metadata });
    await appendAuditEvent({ actorUserId: session.userId, action: 'BOOKING.CARD_CHECK_FAILED', targetType: 'User', targetId: session.userId, metadata });
  } catch (error) {
    // Reporting must never become the customer's problem.
    console.error('[card-check] could not record a card step failure', error instanceof Error ? error.message : 'unknown');
  }
}
