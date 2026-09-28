import type { ContentStatus } from '@/app/services/admin-content-status';

type Labels = { chineseMissing: string; draftPending: string };

/**
 * Translation badges for one row of an admin list. Labels come from the
 * caller's dictionary so this stays a plain component (no i18n imports),
 * usable from any server page.
 */
export function ContentStatusBadges({ status, labels }: { status: ContentStatus | undefined; labels: Labels }) {
  if (!status || (status.chinesePublished && !status.draftPending)) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5 mt-1">
      {!status.chinesePublished && (
        <span className="inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full bg-amber-50 text-amber-800 border border-amber-200">
          {labels.chineseMissing}
        </span>
      )}
      {status.draftPending && (
        <span className="inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200">
          {labels.draftPending}
        </span>
      )}
    </span>
  );
}
