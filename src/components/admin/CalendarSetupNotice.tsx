import Link from 'next/link';
import type { SyncCoverage } from '@/app/services/treatwell-sync-coverage';

type Props = {
  coverage: Pick<SyncCoverage, 'blockers'>;
  bookingEnabled: boolean;
  scheduledSyncEnabled: boolean;
};

export function CalendarSetupNotice({ coverage, bookingEnabled, scheduledSyncEnabled }: Props) {
  if (coverage.blockers.length === 0) return null;

  // Keep every blocker, including future/unlabelled checks. Existing checks use
  // a stylist or stylist/provider prefix, so their instructions can sit together.
  const groups = new Map<string, string[]>();
  for (const blocker of coverage.blockers) {
    const separator = blocker.indexOf(': ');
    const label = separator > 0 ? blocker.slice(0, separator) : 'General setup';
    const detail = separator > 0 ? blocker.slice(separator + 2) : blocker;
    groups.set(label, [...(groups.get(label) ?? []), detail]);
  }

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
            <h2 id="calendar-setup-heading" className="font-semibold text-zinc-900">Calendar setup needs attention</h2>
            <p className="mt-1 max-w-prose text-sm leading-6 text-zinc-600">
              {bookingEnabled
                ? 'Website bookings are blocked by these calendar checks.'
                : 'Website booking is switched off. Complete these checks before opening it.'}
            </p>
            <p className="mt-1 max-w-prose text-sm leading-6 text-zinc-600">
              Review provider calendars before confirming appointments.
            </p>
          </div>
        </div>
        <Link href="/admin/integrations" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-[#174F7F]/20 px-4 py-2 text-sm font-semibold text-[#174F7F] transition-colors hover:bg-[#174F7F]/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174F7F]">
          Review integrations
        </Link>
      </div>
      <details className="border-t border-zinc-100 px-4 sm:px-5">
        <summary className="cursor-pointer py-3 text-sm font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174F7F]">
          View {coverage.blockers.length} setup {coverage.blockers.length === 1 ? 'check' : 'checks'}
          {!scheduledSyncEnabled && <span className="ml-2 inline-block text-xs font-normal text-amber-800">Scheduled sync is off</span>}
        </summary>
        <p className="mb-4 max-w-prose text-sm leading-6 text-zinc-600">
          These checks report missing or outdated setup evidence. Appointment conflicts are checked separately.
          {!scheduledSyncEnabled && ' Enable scheduled sync after configuring and testing the calendar feeds.'}
        </p>
        <div className="grid gap-x-8 gap-y-5 pb-5 lg:grid-cols-2">
          {[...groups].map(([label, checks]) => (
            <div key={label} className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-900">{label}</h3>
              <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-zinc-600">
                {checks.map((check, index) => <li key={index} className="break-words">{check}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
