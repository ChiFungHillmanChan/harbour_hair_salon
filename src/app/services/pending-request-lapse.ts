import 'server-only';
import prisma from '@/app/lib/prisma';
import { appendAuditEvent } from '@/app/lib/audit';
import { hasAppointmentEnded } from '@/app/lib/appointment-timing';
import { runSerializableWithRetry } from './booking-service';
import { linkedDepositSelect, planDepositForClosing, releaseDepositHold, settleDepositBeforeClosing, submitDepositRefund } from './deposit-lifecycle';
import { enqueueAppointmentNotification } from './notification-outbox-service';
import { isRequestLapseNoticeDue, readSalonPhoneForLapseNotice } from './request-lapse-notice';
import { invalidateStylistIcalFeedFromCron } from './stylist-ical-cache';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from './treatwell-api';

const lapseInclude = {
  user: { select: { email: true, name: true, phone: true } },
  stylist: { select: { name: true, treatwellExternalId: true } },
  service: { select: { id: true, name: true, price: true, duration: true, treatwellExternalId: true } },
  paymentAttempt: { select: linkedDepositSelect },
} as const;

/**
 * Deposits where money moved or may have: being taken (CAPTURING), a capture
 * nobody saw finish (CAPTURE_UNKNOWN), or taken (CAPTURED). While the
 * appointment is still ahead staff decide — confirming finishes or keeps it,
 * declining refunds it. Once it has ended nobody can confirm it any more
 * (approval refuses from the start), but staff can still mark a customer who
 * came "completed" (the deposit is kept towards the bill) or decline the
 * request (refunded). So only the DAILY housekeeping run (`takenDeposits`),
 * and only TAKEN_DEPOSIT_LAPSE_GRACE_MS after the appointment ended, settles
 * a capture with Square and closes the request as a staff decline would,
 * refunding a taken deposit in full.
 */
const MONEY_IN_FLIGHT = ['CAPTURING', 'CAPTURE_UNKNOWN', 'CAPTURED'];

/**
 * How long after its appointment ended a request whose deposit was taken (or
 * may have been) is left for staff to mark completed (keeping the deposit) or
 * decline (refunding it) before the daily run refunds it by itself. The
 * notifications cron runs every half hour during the day: without this, the
 * first run after a visit refunded a customer who had just been served.
 */
export const TAKEN_DEPOSIT_LAPSE_GRACE_MS = 12 * 60 * 60_000;

/** Captures nobody saw finish: settled from Square's word before their request can close (deposit-lifecycle.ts). */
const UNSETTLED_CAPTURE = ['CAPTURING', 'CAPTURE_UNKNOWN'];

/** Started requests with money in flight are looked at in their own batch, so a few that cannot settle yet never crowd out the rest. */
const MONEY_IN_FLIGHT_BATCH = 10;

/**
 * Settling captures with Square before the lapses stops starting new reads
 * after this long (each can take 10 seconds); the rest wait for the next run.
 */
const SETTLE_BUDGET_MS = 10_000;

/**
 * Releasing holds and asking Square for refunds after the lapses commit stops
 * after this long (each Square call can take 10 seconds). Whatever is left is
 * picked up by the daily reconciliation — an AUTHORIZED hold on a cancelled
 * request, a REQUESTED refund — and Square drops an untaken hold when it runs
 * out anyway.
 */
const AFTER_COMMIT_BUDGET_MS = 15_000;

/**
 * Close booking requests (PENDING) nobody confirmed in time, once their
 * appointment has ENDED. Owner policy: a request lapses when its time passes
 * unanswered — from its start it can no longer be confirmed
 * (updateAppointmentStatus refuses), so leaving it open only kept it at the top
 * of the admin "awaiting confirmation" list forever. It is closed at the end,
 * not the start: a staff "pencil in" is PENDING too and its customer may be in
 * the chair, and a cancelled booking leaves the stylist busy feed at once, so
 * closing it mid-visit would let a marketplace resell the rest of that time.
 * Meanwhile staff can mark it completed (or decline it) from the board. The
 * query takes every started request (`date <= now`, cheap); one that has not
 * ended is re-checked inside its transaction and skipped — neither lapsed nor
 * a failure — until a later run.
 *
 * Card deposits (docs/superpowers/specs/2026-10-13-square-deposits-design.md):
 *  - A request whose hold is gone is closed at once even though its time is
 *    still ahead — it can never be confirmed online now: the hold ran out
 *    (`delayedUntil` passed: recorded EXPIRED, Square drops it by itself), or
 *    Square already let it go (EXPIRED, as the webhook or reconciliation
 *    recorded it), or this site released it (VOIDED — a booking whose answer
 *    was lost, say). Nothing is asked of Square; the email says the request
 *    closed while the hold was meant to be valid (`holdExpired`).
 *  - Any other live hold is released after its lapse commits.
 *  - A deposit taken, or being taken, is left to staff — to confirm while the
 *    appointment is ahead, then to mark completed (kept) or decline (refunded)
 *    — and is only ever lapsed by the daily housekeeping run (`takenDeposits`),
 *    once its appointment ended at least TAKEN_DEPOSIT_LAPSE_GRACE_MS (12
 *    hours) earlier: a capture nobody saw finish is settled with Square first
 *    (outside any transaction, and only once it has been quiet for
 *    CAPTURE_STALE_MS — a timed-out capture may still land); a deposit Square
 *    took is then refunded in full (REQUEST_LAPSED: the refund row in the
 *    lapse's transaction, Square after the commit) and the email says it is
 *    being refunded — exactly as a staff decline of the request would. The
 *    notifications cron never does.
 *
 * Each request is cancelled (version bumped, so earlier queued request mail is
 * retired), audited and — if the customer was told it was awaiting
 * confirmation — sent one REQUEST_LAPSED email (saying what became of the
 * deposit, when there was one), all in one transaction and only if it is still
 * the same unanswered request, so a re-run or a racing staff decision never
 * doubles anything. Whether that email goes is decided by
 * isRequestLapseNoticeDue (request-lapse-notice.ts), the rule staff declining a
 * started request also follows: a staff "pencil in" (also PENDING) was never
 * announced to the customer, who has often simply come in, so it is closed
 * silently, as is a backlog older than REQUEST_LAPSE_NOTICE_HOURS. A row that
 * throws is logged and skipped (it stays due and is retried next run); a
 * failed salon-phone read only drops the phone callout.
 *
 * Runs in the notifications cron and the daily housekeeping cron, so requests
 * still lapse while email sending is switched off (the emails then wait in the
 * outbox like every other kind); only housekeeping passes `takenDeposits`.
 * Both callers are Route Handlers, hence the cron flavour of the busy-feed
 * invalidation.
 */
export async function lapseStartedPendingRequests(
  now: Date,
  options: { takenDeposits?: boolean; limit?: number } = {},
): Promise<{ lapsed: number; failed: number }> {
  const limit = options.limit ?? 50;
  const takenDeposits = options.takenDeposits === true;
  /** A request with money in flight lapses only once its appointment ended by this instant. */
  const takenCutoff = new Date(now.getTime() - TAKEN_DEPOSIT_LAPSE_GRACE_MS);
  const due = await prisma.appointment.findMany({
    where: {
      status: 'PENDING',
      OR: [
        { date: { lte: now } },
        { paymentAttempt: { is: { status: 'AUTHORIZED', delayedUntil: { lte: now } } } },
        { paymentAttempt: { is: { status: { in: ['EXPIRED', 'VOIDED'] } } } },
      ],
      NOT: { paymentAttempt: { is: { status: { in: MONEY_IN_FLIGHT } } } },
    },
    select: { id: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  // Money in flight: the daily run only, started at least the grace period ago
  // (cheap; whether it also ENDED that long ago is checked per row below).
  const inFlight = takenDeposits ? await prisma.appointment.findMany({
    where: { status: 'PENDING', date: { lte: takenCutoff }, paymentAttempt: { is: { status: { in: MONEY_IN_FLIGHT } } } },
    select: { id: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: MONEY_IN_FLIGHT_BATCH,
  }) : [];
  let lapsed = 0;
  let failed = 0;
  if (due.length === 0 && inFlight.length === 0) return { lapsed, failed };
  // Once per run: the email tells the customer how to call the salon. A failed
  // read sends the emails without the phone rather than leaving requests open.
  const salonPhone = await readSalonPhoneForLapseNotice(prisma);

  let settleStarted: number | null = null;
  /**
   * A started request with money in flight may close only once its
   * appointment ended TAKEN_DEPOSIT_LAPSE_GRACE_MS ago and its deposit is
   * settled: a capture nobody saw finish is read from Square first
   * (settleDepositBeforeClosing — CAPTURED, still held or dropped), and not at
   * all while it is still quiet for less than CAPTURE_STALE_MS, while Square
   * cannot say, or once this run's budget for Square reads is spent.
   */
  const settledForLapse = async (id: string): Promise<boolean> => {
    const current = await prisma.appointment.findUnique({
      where: { id },
      select: { status: true, date: true, durationAtBooking: true, service: { select: { duration: true } }, paymentAttempt: { select: { status: true } } },
    });
    if (!current || current.status !== 'PENDING') return false;
    if (!hasAppointmentEnded(current.date, current.durationAtBooking ?? current.service.duration, takenCutoff)) return false;
    if (!current.paymentAttempt || !UNSETTLED_CAPTURE.includes(current.paymentAttempt.status)) return true;
    settleStarted ??= Date.now();
    if (Date.now() - settleStarted > SETTLE_BUDGET_MS) return false;
    return (await settleDepositBeforeClosing(prisma, id, now)) === null;
  };

  const afterCommit: { release: string | null; refund: string | null }[] = [];
  const candidates = [...due.map(({ id }) => ({ id, moneyInFlight: false })), ...inFlight.map(({ id }) => ({ id, moneyInFlight: true }))];
  for (const { id, moneyInFlight } of candidates) {
    try {
      if (moneyInFlight && !(await settledForLapse(id))) continue;
      const done = await runSerializableWithRetry(async (tx) => {
        const current = await tx.appointment.findUnique({ where: { id }, include: lapseInclude });
        if (!current || current.status !== 'PENDING') return null;
        const deposit = current.paymentAttempt;
        // Being taken, or not settled yet: a later run.
        if (deposit && UNSETTLED_CAPTURE.includes(deposit.status)) return null;
        // Taken — perhaps since this request was picked as due: staff's to mark
        // completed (kept) or decline (refunded) until the daily run, 12 hours
        // after the appointment ended.
        if (deposit?.status === 'CAPTURED'
          && !(takenDeposits && hasAppointmentEnded(current.date, current.durationAtBooking ?? current.service.duration, takenCutoff))) return null;
        // Its hold ran out, or Square already let it go (EXPIRED).
        const holdExpired = deposit?.status === 'EXPIRED'
          || (deposit?.status === 'AUTHORIZED' && (!deposit.delayedUntil || deposit.delayedUntil.getTime() <= now.getTime()));
        // …or this site released it (VOIDED): either way it can never be confirmed now.
        const holdGone = holdExpired || deposit?.status === 'VOIDED';
        const ended = hasAppointmentEnded(current.date, current.durationAtBooking ?? current.service.duration, now);
        // (A taken deposit, CAPTURED, is never "gone": its request closes only once ended.)
        if (!ended && !holdGone) return null;
        const api = getTreatwellApiConfiguration();
        const closed = await tx.appointment.updateMany({
          where: { id, status: 'PENDING', date: current.date },
          data: {
            status: 'CANCELLED',
            notificationVersion: { increment: 1 },
            rescheduleRequestedDate: null,
            rescheduleRequestedAt: null,
            // Same as a staff cancellation: undo anything already sent to Treatwell.
            treatwellSyncStatus: changedTreatwellSyncStatus({
              apiReady: api.enabled && api.configured,
              treatwellBookingId: current.treatwellBookingId,
              stylistExternalId: current.stylist.treatwellExternalId,
              serviceExternalId: current.service.treatwellExternalId,
            }),
            treatwellSyncError: null,
          },
        });
        if (closed.count !== 1) return null;
        // The deposit, closed as a staff decline closes a request's: a live
        // hold is released after the commit (one already run out is recorded
        // EXPIRED now); a taken deposit is refunded in full — a REQUESTED
        // refund row now, Square after the commit.
        const money = await planDepositForClosing(tx, id, { closing: 'CANCEL', refund: true, reason: 'REQUEST_LAPSED', requestedById: null, now });
        const announced = await isRequestLapseNoticeDue(tx, current, now);
        const updated = announced ? await tx.appointment.findUnique({ where: { id }, include: lapseInclude }) : null;
        // The outbox itself skips an undeliverable (walk-in or erased) address.
        const queued = updated
          ? await enqueueAppointmentNotification(tx, 'REQUEST_LAPSED', { ...updated, paymentAttempt: money.paymentAttempt }, {
            salonPhone,
            ...(money.outcome ? { depositOutcome: money.outcome } : {}),
            // Closed for its hold while the requested time is still ahead.
            ...(holdGone && !ended ? { holdExpired: true } : {}),
          })
          : null;
        await appendAuditEvent({ actorUserId: null, action: 'APPOINTMENT.LAPSED', targetType: 'Appointment', targetId: id, metadata: {
          from: 'PENDING', to: 'CANCELLED', start: current.date.toISOString(), notified: Boolean(queued),
          ...(deposit ? { deposit: holdExpired ? 'EXPIRED' : money.outcome, depositPence: deposit.amountPence } : {}),
        } }, tx);
        return { release: money.releaseAttemptId, refund: money.refundId };
      });
      if (done) {
        lapsed++;
        afterCommit.push(done);
      }
    } catch (error) {
      console.error('Lapsing a booking request failed:', { appointmentId: id, error: error instanceof Error ? error.name : 'unknown' });
      failed++;
    }
  }
  if (lapsed > 0) {
    // A request held its chair in the marketplaces' busy feed until now. The
    // feed's one-day safety net heals a failed drop, so never fail the run.
    try {
      invalidateStylistIcalFeedFromCron();
    } catch (error) {
      console.error('Dropping the busy-feed cache after request lapses failed:', error instanceof Error ? error.name : 'unknown');
    }
  }
  // Now that each lapse has committed: release the holds and ask Square for
  // the refunds (neither ever throws).
  const afterStarted = Date.now();
  for (const { release, refund } of afterCommit) {
    if (Date.now() - afterStarted > AFTER_COMMIT_BUDGET_MS) break;
    if (release) await releaseDepositHold(prisma, release);
    if (refund) await submitDepositRefund(prisma, refund);
  }
  return { lapsed, failed };
}
