import Link from '@/i18n/link';
import { getT } from '@/i18n/server';
import type { SyncCoverage } from '@/app/services/treatwell-sync-coverage';

type Props = {
  /** `issues` are the coded form of `blockers`, one per blocker in the same order. */
  coverage: Pick<SyncCoverage, 'blockers'> & Partial<Pick<SyncCoverage, 'issues'>>;
  bookingEnabled: boolean;
  scheduledSyncEnabled: boolean;
};

type Check = { text: string; english: boolean };

/**
 * A check reads "Ava / FRESHA: …" on its own; here it sits under an
 * "Ava / FRESHA" heading, so drop that lead-in (either colon style).
 */
function withoutLabel(text: string, label: string): string {
  if (!label) return text;
  for (const separator of [': ', '：']) {
    if (text.startsWith(`${label}${separator}`)) return text.slice(label.length + separator.length);
  }
  return text;
}

export async function CalendarSetupNotice({ coverage, bookingEnabled, scheduledSyncEnabled }: Props) {
  if (coverage.blockers.length === 0) return null;
  const [t, tOps] = await Promise.all([getT('adminSchedule'), getT('adminOps')]);
  // A check without a translation is shown as generated (English), and marked
  // so on a Chinese page; stylist and platform names are never translated.
  const englishLang = t.locale === 'en-GB' ? undefined : 'en';
  const coded = coverage.issues?.length === coverage.blockers.length ? coverage.issues : null;

  // Keep every blocker, including future/unlabelled checks. Checks about one
  // stylist or stylist/provider connection sit together under that heading.
  const groups = new Map<string, Check[]>();
  coverage.blockers.forEach((blocker, index) => {
    const issue = coded?.[index];
    const separator = blocker.indexOf(': ');
    const label = issue
      ? [issue.params?.stylist, issue.params?.provider].filter(Boolean).join(' / ')
      : separator > 0 ? blocker.slice(0, separator) : '';
    const translated = issue ? tOps.dynamic(`readiness.calendar.${issue.code}`, issue.params, '') : '';
    const check = translated
      ? { text: withoutLabel(translated, label), english: false }
      : { text: withoutLabel(blocker, label), english: true };
    groups.set(label, [...(groups.get(label) ?? []), check]);
  });

  return (
    <section aria-labelledby="calendar-setup-heading" className="mb-6 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 gap-3">
          <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M12 7v6m0 4h.01" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="calendar-setup-heading" className="font-semibold text-zinc-900">{t('notice.title')}</h2>
            <p className="mt-1 max-w-prose text-sm leading-6 text-zinc-600">
              {bookingEnabled ? t('notice.blocked') : t('notice.off')}
            </p>
            <p className="mt-1 max-w-prose text-sm leading-6 text-zinc-600">
              {t('notice.review')}
            </p>
          </div>
        </div>
        <Link href="/admin/integrations" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-[#174F7F]/20 px-4 py-2 text-sm font-semibold text-[#174F7F] transition-colors hover:bg-[#174F7F]/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174F7F]">
          {t('notice.link')}
        </Link>
      </div>
      <details className="border-t border-zinc-100 px-4 sm:px-5">
        <summary className="cursor-pointer py-3 text-sm font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174F7F]">
          {t('notice.summary', { count: coverage.blockers.length })}
          {!scheduledSyncEnabled && <span className="ml-2 inline-block text-xs font-normal text-amber-800">{t('notice.syncOff')}</span>}
        </summary>
        <p className="mb-4 max-w-prose text-sm leading-6 text-zinc-600">
          {t('notice.evidence')}
          {!scheduledSyncEnabled && ` ${t('notice.enableSync')}`}
        </p>
        <div className="grid gap-x-8 gap-y-5 pb-5 lg:grid-cols-2">
          {[...groups].map(([label, checks]) => (
            <div key={label} className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-900">{label || t('notice.general')}</h3>
              <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-zinc-600">
                {checks.map((check, index) => <li key={index} lang={check.english ? englishLang : undefined} className="break-words">{check.text}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
