import Link from '@/i18n/link';
import { DEPOSIT_REFUND_NOTICE_HOURS, LATE_ARRIVAL_CANCEL_MINUTES, ONLINE_CANCEL_NOTICE_HOURS } from '@/app/lib/booking-constants';
import { rich } from '@/i18n/rich';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages/types-client';

// What the review step says about a card deposit. No hooks and no 'use
// client': the wizard passes its translator and price formatter, so tests can
// render these directly.

type BookingT = Translate<Messages['booking']>;

/**
 * The price facts that make the amount left to pay less than exact, as
 * PriceFinePrint shows them on the price: VAT `EXCLUDED`, or a price
 * `SUBJECT_TO_CONSULTATION` (pricing/policy.ts).
 */
export type RemainderPriceFacts = { vatDisplay?: string | null; priceNature?: string | null };

/**
 * Two more rows for the booking summary's price block: the deposit taken if
 * the salon confirms, and the rest in the salon — with the price's own fine
 * print when the rest is not exact (VAT excluded, or the final price is
 * confirmed at the consultation).
 */
export function DepositRows({ t, formatPrice, depositPence, remainderPence, price = {} }: {
  t: BookingT;
  formatPrice: (pence: number) => string;
  depositPence: number;
  remainderPence: number;
  price?: RemainderPriceFacts;
}) {
  const notes = [
    ...(price.vatDisplay === 'EXCLUDED' ? [t('deposit.restVatExcluded')] : []),
    ...(price.priceNature === 'SUBJECT_TO_CONSULTATION' ? [t('deposit.restMayChange')] : []),
  ];
  return (
    <>
      <div className="mt-3 flex justify-between items-baseline gap-4">
        <dt className="text-zinc-900 font-medium">{t('deposit.now')}</dt>
        <dd className="text-right text-lg font-bold text-zinc-900 tabular-nums">{formatPrice(depositPence)}</dd>
      </div>
      <div className="mt-1 flex justify-between items-baseline gap-4">
        <dt className="text-zinc-600">{t('deposit.rest')}</dt>
        <dd className="text-right text-zinc-700 tabular-nums">
          {formatPrice(remainderPence)}
          {notes.length > 0 && <span className="block text-[11px] leading-snug text-zinc-500">{notes.join(' · ')}</span>}
        </dd>
      </div>
    </>
  );
}

/**
 * What the customer agrees to, before the card form: nothing is paid now,
 * the deposit is taken only if the salon confirms, the refund rule
 * (DEPOSIT_REFUND_NOTICE_HOURS) and when the deposit is kept — plus a warning
 * when the appointment is already inside that window (once confirmed, a
 * cancellation keeps the deposit), worded for the last
 * ONLINE_CANCEL_NOTICE_HOURS too (it can then not be cancelled online at all).
 * The full terms open in a new tab, so the wizard keeps what was chosen.
 */
export function DepositTerms({ t, amount, startsWithin24Hours = false, startsWithinRefundNotice = false }: {
  t: BookingT;
  /** The deposit, formatted. */
  amount: string;
  /** Less than ONLINE_CANCEL_NOTICE_HOURS away. */
  startsWithin24Hours?: boolean;
  /** Less than DEPOSIT_REFUND_NOTICE_HOURS away. */
  startsWithinRefundNotice?: boolean;
}) {
  const warning = startsWithin24Hours
    ? t('deposit.soonWarning', { hours: ONLINE_CANCEL_NOTICE_HOURS })
    : startsWithinRefundNotice ? t('deposit.refundWarning', { hours: DEPOSIT_REFUND_NOTICE_HOURS }) : null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 leading-relaxed">
      <p>{t('deposit.payNothingNow', { amount })}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>{t('deposit.refund', { hours: DEPOSIT_REFUND_NOTICE_HOURS })}</li>
        <li>{t('deposit.lateOrNoShow', { hours: DEPOSIT_REFUND_NOTICE_HOURS, minutes: LATE_ARRIVAL_CANCEL_MINUTES })}</li>
      </ul>
      {warning && (
        <p className="mt-3 rounded border border-zinc-400 bg-white px-3 py-2 font-medium text-zinc-900" role="note">
          {warning}
        </p>
      )}
      <p className="mt-2">
        {rich(t('deposit.termsLink'), {
          link: (text) => (
            <Link href="/booking-terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-zinc-900">
              {text}
              <span className="sr-only"> {t('deposit.opensInNewTab')}</span>
            </Link>
          ),
        })}
      </p>
    </div>
  );
}

/**
 * A deposit is due but this site cannot take card payments right now (Square
 * not configured): the booking cannot be made online, so the card form is
 * replaced by the salon's phone number.
 */
export function PaymentUnavailableNotice({ t, phone }: { t: BookingT; phone: string }) {
  return (
    <div className="rounded-lg border border-zinc-300 bg-white p-4 text-sm text-zinc-800" role="status">
      <p>
        {rich(t('deposit.unavailable', { phone }), {
          link: (text) => <a href={`tel:${phone.replace(/\s+/g, '')}`} className="font-semibold underline underline-offset-2 hover:text-zinc-950">{text}</a>,
        })}
      </p>
    </div>
  );
}
