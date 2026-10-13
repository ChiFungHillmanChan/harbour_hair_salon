import type { DepositView } from '@/app/lib/deposit-display';
import { formatGBP } from '@/app/services/pricing/money';
import { HTML_LANG } from '@/i18n/config';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages/types-client';

/**
 * A booking's card deposit on the admin board (held, paid, refund pending, …;
 * lib/deposit-display.ts). Monochrome, like the rest of the brand: a light
 * outline on white, or the block's own text colour on a stylist-coloured
 * calendar block (`onColour`). No hooks: the board and the dialog pass the
 * `adminSchedule` translator they already hold.
 */
export function DepositChip({ deposit, t, onColour = false, className = '' }: {
  deposit: DepositView;
  t: Translate<Messages['adminSchedule']>;
  onColour?: boolean;
  className?: string;
}) {
  const amount = formatGBP(deposit.amountPence, HTML_LANG[t.locale]);
  const look = onColour ? 'border-current' : 'border-zinc-400 bg-white text-zinc-700';
  return (
    <span className={`inline-block max-w-full truncate rounded border px-1.5 py-0.5 text-[10px] font-medium leading-tight ${look} ${className}`}>
      {t.dynamic(`deposit.chip.${deposit.state}`, { amount })}
    </span>
  );
}
