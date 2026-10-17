'use client';

import { useId, useState, type ReactNode } from 'react';

/** Keep secondary tools close at hand on phones; retain the full desktop panels. */
export function MobileScheduleDisclosure({ label, count, attention = false, children }: {
  label: string;
  count?: number;
  attention?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded(value => !value)}
        className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 sm:hidden ${attention ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-zinc-200 bg-white text-zinc-700'}`}
      >
        <svg aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
        </svg>
        <span className="min-w-0 flex-1">{label}</span>
        {count !== undefined && count > 0 && <span className="rounded-full bg-white px-2 py-0.5 tabular-nums">{count}</span>}
      </button>
      <div id={contentId} className={`${expanded ? 'mt-2' : 'hidden'} sm:mt-0 sm:block`}>
        {children}
      </div>
    </div>
  );
}
