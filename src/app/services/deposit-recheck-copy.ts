import { HTML_LANG, type Locale } from '@/i18n/config';
import { translator } from '@/i18n/messages';
import { formatGBP } from './pricing/money';
import type { DepositRecheck } from './payment-reconciliation';

/**
 * What "Re-check payment" tells staff, in their language
 * (`adminSchedule.deposit.recheck`): whether Square could be reached, the
 * deposit as it is now, then each of its refunds. Amounts and states only.
 */
export function describeDepositRecheck(result: DepositRecheck, locale: Locale): string[] {
  const t = translator(locale, 'adminSchedule');
  if (result.kind === 'NONE') return [t('deposit.recheck.states.NONE')];
  if (result.kind === 'UNAVAILABLE') return [t('deposit.recheck.states.UNAVAILABLE')];
  const amount = (pence: number) => formatGBP(pence, HTML_LANG[locale]);
  return [
    ...(result.reached ? [] : [t('deposit.recheck.unreachable')]),
    t.dynamic(`deposit.recheck.states.${result.state}`, { amount: amount(result.amountPence) }),
    ...result.refunds.map((refund) => t('deposit.recheck.refund', {
      amount: amount(refund.amountPence),
      status: t.dynamic(`deposit.recheck.refundStatus.${refund.status}`, undefined, refund.status),
    })),
  ];
}
