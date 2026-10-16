'use server';

import { revalidatePath } from 'next/cache';
import { appendAuditEvent } from '@/app/lib/audit';
import { describeFault } from '@/app/lib/fault';
import { verifySession } from '@/app/lib/session';
import { bookingErrorText } from '@/app/services/booking-errors';
import { describeDepositRecheck } from '@/app/services/deposit-recheck-copy';
import { recheckAppointmentDeposit, type DepositRecheck } from '@/app/services/payment-reconciliation';
import { settleRefundOutsideWebsite, type SettleOutsideOutcome } from '@/app/services/payment-refunds';
import { formatGBP } from '@/app/services/pricing/money';
import { scheduleGoogleCalendarPush } from '@/app/services/stylist-ical-cache';
import { HTML_LANG } from '@/i18n/config';
import { translator } from '@/i18n/messages';
import { getActionLocale } from '@/i18n/request';
import { revalidateAllLocales } from '@/i18n/revalidate';

export type PaymentRecheckResult = { success: true; lines: string[] } | { success: false; error: string };
export type RefundSettleResult = { success: true; message: string } | { success: false; error: string };

const APPOINTMENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Our own refund row ids (cuid), never Square's. */
const REFUND_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Admin → Schedule → "Re-check payment" (docs/square-payments-setup.md §6):
 * ask Square about one booking's card deposit and its refunds now — the same
 * checks as the daily reconciliation (services/payment-reconciliation.ts),
 * without its waiting period — and say, in the admin's language, what is true.
 * Administrators only; every re-check is audited (PAYMENT.RECHECKED).
 */
export async function recheckAppointmentPayment(appointmentId: string): Promise<PaymentRecheckResult> {
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { success: false, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  if (typeof appointmentId !== 'string' || !APPOINTMENT_ID.test(appointmentId)) {
    return { success: false, error: bookingErrorText(locale, 'APPOINTMENT_NOT_FOUND') };
  }
  let result: DepositRecheck;
  try {
    result = await recheckAppointmentDeposit(appointmentId);
  } catch (error) {
    console.error('Re-checking a payment failed', { appointmentId, ...describeFault(error) });
    return { success: false, error: translator(locale, 'adminSchedule')('deposit.recheck.failed') };
  }
  try {
    await appendAuditEvent({
      actorUserId: session.userId, action: 'PAYMENT.RECHECKED', targetType: 'Appointment', targetId: appointmentId,
      metadata: result.kind === 'CHECKED'
        ? {
          result: result.state, reached: result.reached, before: result.before.status, after: result.after.status,
          refundsBefore: result.before.refunds.join(','), refundsAfter: result.after.refunds.join(','),
        }
        : { result: result.kind },
    });
  } catch (error) {
    // The check itself is done (and every money step it took is on the rows); say so.
    console.error('Recording a payment re-check failed', { appointmentId, ...describeFault(error) });
  }
  // The board's deposit chip, the customer's own booking page, and the
  // deposit line of the booking's Google Calendar event.
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/appointments');
  scheduleGoogleCalendarPush([appointmentId]);
  return { success: true, lines: describeDepositRecheck(result, locale) };
}

/**
 * Admin → Schedule → booking → "Mark refund as settled outside the website"
 * (docs/square-payments-setup.md §6): staff refunded the customer themselves —
 * in the Square Dashboard, or in cash — for a refund Square has not confirmed,
 * so the website must never send it to Square again
 * (payment-refunds.ts settleRefundOutsideWebsite: REQUESTED, UNKNOWN,
 * UNRESOLVED or a stale SUBMITTING → SETTLED_EXTERNALLY, audited
 * `PAYMENT.REFUND_SETTLED_OUTSIDE`, still counted against the deposit).
 * Administrators only. Works with Square payments switched off here: nothing
 * is asked of Square.
 */
export async function markRefundSettledOutside(appointmentId: string, refundId: string): Promise<RefundSettleResult> {
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { success: false, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  const t = translator(locale, 'adminSchedule');
  if (typeof appointmentId !== 'string' || !APPOINTMENT_ID.test(appointmentId) || typeof refundId !== 'string' || !REFUND_ID.test(refundId)) {
    return { success: false, error: t('deposit.settleOutside.notFound') };
  }
  let outcome: SettleOutsideOutcome;
  try {
    // Read per call (and only here): the module never opens the database at load.
    const { default: prisma } = await import('@/app/lib/prisma');
    outcome = await settleRefundOutsideWebsite(prisma, { appointmentId, refundId, adminId: session.userId, now: new Date() });
  } catch (error) {
    console.error('Marking a refund settled outside the website failed', { appointmentId, refundId, ...describeFault(error) });
    return { success: false, error: t('deposit.settleOutside.failed') };
  }
  switch (outcome.kind) {
    case 'SETTLED':
      // The board's deposit chip, the customer's own booking page, and the
      // deposit line of the booking's Google Calendar event.
      revalidateAllLocales(revalidatePath, '/admin');
      revalidateAllLocales(revalidatePath, '/appointments');
      scheduleGoogleCalendarPush([appointmentId]);
      return { success: true, message: t('deposit.settleOutside.done', { amount: formatGBP(outcome.amountPence, HTML_LANG[locale]) }) };
    case 'SENDING':
      return { success: false, error: t('deposit.settleOutside.sending') };
    case 'ANSWERED':
      return { success: false, error: t('deposit.settleOutside.answered', { status: t.dynamic(`deposit.recheck.refundStatus.${outcome.status}`, undefined, outcome.status) }) };
    case 'CHANGED':
      return { success: false, error: t('deposit.settleOutside.changed') };
    default:
      return { success: false, error: t('deposit.settleOutside.notFound') };
  }
}
