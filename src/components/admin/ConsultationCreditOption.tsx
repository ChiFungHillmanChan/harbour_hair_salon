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

/**
 * "Consultation credit available: £15 (consultation on 12 Oct) — deduct from
 * this booking" (spec §2.3), for a consultation-required service. Shows what
 * the server says is available; saving looks it up again, so the box only
 * says whether to apply it.
 */
export function ConsultationCreditOption({
  lookup,
  apply,
  onApplyChange,
  recorded,
}: {
  /** Null while no customer is known: a walk-in with no account has had no consultation. */
  lookup: ConsultationCreditLookup | null;
  apply: boolean;
  onApplyChange: (apply: boolean) => void;
  /** The credit this booking already records, when editing one. */
  recorded: RecordedConsultationCredit | null;
}) {
  const t = useT('adminSchedule');
  const locale = useLocale();
  const key = lookup ? JSON.stringify(lookup) : '';
  // Answers carry the question they answered, so a slow reply about a previous
  // customer, service or time is never shown under the current one.
  const [preview, setPreview] = useState<{ key: string; result: ConsultationCreditPreview } | null>(null);

  // Debounced like the customer search: a typed email or time costs one read.
  useEffect(() => {
    if (!key) return;
    let live = true;
    const id = setTimeout(async () => {
      let result: ConsultationCreditPreview;
      try {
        result = await previewConsultationCredit(JSON.parse(key) as ConsultationCreditLookup);
      } catch {
        result = { available: false };
      }
      if (live) setPreview({ key, result });
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [key]);

  const result = key && preview?.key === key ? preview.result : null;
  if (!recorded && !result?.available) return null;

  const amount = (pence: number) => formatGBP(pence, HTML_LANG[locale]);
  const day = (iso: string) => formatSalonMediumDate(locale, new Date(iso));

  return (
    <div className="space-y-1 rounded border border-zinc-200 bg-zinc-50 px-3 py-3" aria-live="polite">
      {recorded && (
        <p className="text-sm text-zinc-800">
          {t('credit.recorded', { amount: amount(recorded.amountPence), date: day(recorded.consultationDate) })}
        </p>
      )}
      {result?.available && (
        <>
          <label className="flex items-start gap-2 text-sm text-zinc-800">
            <input type="checkbox" className="mt-0.5" checked={apply} onChange={(event) => onApplyChange(event.target.checked)} />
            <span>{t('credit.available', { amount: amount(result.amountPence), date: day(result.consultationDate) })}</span>
          </label>
          <p className="text-xs text-zinc-500">{t('credit.help')}</p>
        </>
      )}
      {recorded && result && !result.available && <p className="text-xs text-zinc-500">{t('credit.noLongerAvailable')}</p>}
    </div>
  );
}
