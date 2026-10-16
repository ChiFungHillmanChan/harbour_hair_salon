'use client';

import { useEffect, useState } from 'react';
import { previewConsultationCredit, type ConsultationCreditPreview } from '@/app/actions/admin-consultation-credit';
import { formatGBP } from '@/app/services/pricing/money';
import { formatSalonMediumDate } from '@/i18n/dates';
import { useLocale, useT } from '@/i18n/client';
import { HTML_LANG } from '@/i18n/config';

/** The credit a booking already records (admin-calendar-data), for the edit dialog. */
export type RecordedConsultationCredit = { amountPence: number; consultationDate: string };

/** Who, what and when the dialog asks about: a picked customer, a typed email, or the booking being edited. */
export type ConsultationCreditLookup = Parameters<typeof previewConsultationCredit>[0];

/** The server's answer for the CURRENT customer, service and time only. */
export type ConsultationCreditPreviewState =
  /** Nothing to ask: no customer is known yet. */
  | { state: 'idle' }
  /** Asked (or about to be); no answer for this exact question yet. */
  | { state: 'checking' }
  /** The question could not be answered: offer nothing and change nothing. */
  | { state: 'failed' }
  | { state: 'answered'; preview: ConsultationCreditPreview };

const IDLE: ConsultationCreditPreviewState = { state: 'idle' };
const CHECKING: ConsultationCreditPreviewState = { state: 'checking' };

/**
 * Asks the server which consultation credit (spec §2.3) a booking for this
 * customer, service and start would record. Debounced like the customer
 * search, so a typed email or time costs one read; an answer is only ever
 * returned for the question it answered.
 */
export function useConsultationCreditPreview(lookup: ConsultationCreditLookup | null): ConsultationCreditPreviewState {
  const key = lookup ? JSON.stringify(lookup) : '';
  const [answer, setAnswer] = useState<{ key: string; state: ConsultationCreditPreviewState } | null>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    const id = setTimeout(async () => {
      let state: ConsultationCreditPreviewState;
      try {
        state = { state: 'answered', preview: await previewConsultationCredit(JSON.parse(key) as ConsultationCreditLookup) };
      } catch {
        state = { state: 'failed' };
      }
      if (live) setAnswer({ key, state });
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [key]);

  if (!key) return IDLE;
  return answer?.key === key ? answer.state : CHECKING;
}

/**
 * "Consultation credit available: £15 (consultation on 12 Oct) — deduct from
 * this booking", for a consultation-required service. Saving looks the credit
 * up again, so the box only says whether to apply it.
 */
export function ConsultationCreditOption({
  preview,
  apply,
  onApplyChange,
  recorded,
}: {
  preview: ConsultationCreditPreviewState;
  apply: boolean;
  onApplyChange: (apply: boolean) => void;
  /** The credit this booking already records, when editing one. */
  recorded: RecordedConsultationCredit | null;
}) {
  const t = useT('adminSchedule');
  const locale = useLocale();
  const answered = preview.state === 'answered' ? preview.preview : null;
  if (!recorded && !answered?.available) return null;

  const amount = (pence: number) => formatGBP(pence, HTML_LANG[locale]);
  const day = (iso: string) => formatSalonMediumDate(locale, new Date(iso));

  return (
    <div className="space-y-1 rounded border border-zinc-200 bg-zinc-50 px-3 py-3" aria-live="polite">
      {recorded && (
        <p className="text-sm text-zinc-800">
          {t('credit.recorded', { amount: amount(recorded.amountPence), date: day(recorded.consultationDate) })}
        </p>
      )}
      {answered?.available && (
        <>
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input type="checkbox" className="mt-0.5" checked={apply} onChange={(event) => onApplyChange(event.target.checked)} />
            <span>{t('credit.available', { amount: amount(answered.amountPence), date: day(answered.consultationDate) })}</span>
          </label>
          <p className="text-xs text-zinc-500">{t('credit.help')}</p>
        </>
      )}
      {recorded && answered && !answered.available && <p className="text-xs text-zinc-500">{t('credit.noLongerAvailable')}</p>}
    </div>
  );
}
