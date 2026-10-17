import Link from '@/i18n/link';
import { PaginationText } from './PaginationText';

/**
 * Previous / page n / next links. Stays a plain (synchronous) component so
 * pages and tests can render it anywhere; its words come from the small client
 * component below, in the page's language.
 */
export function Pagination({ path, page, hasMore, query = {}, pageKey = "page" }: {
  path: string; page: number; hasMore: boolean; query?: Record<string, string>; pageKey?: string;
}) {
  const href = (next: number) => `${path}?${new URLSearchParams({ ...query, [pageKey]: String(next) })}`;
  if (page === 1 && !hasMore) return null;
  const labelId = `pagination-${pageKey}`;
  return <nav aria-labelledby={labelId} className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm sm:justify-start sm:gap-5">
    <PaginationText id={labelId} kind="label" className="sr-only" />
    {page > 1 && <Link href={href(page - 1)} className="inline-flex min-h-11 items-center rounded border border-zinc-300 px-3 py-2 font-medium hover:bg-zinc-100"><PaginationText kind="previous" /></Link>}
    <span><PaginationText kind="page" page={page} /></span>
    {hasMore && <Link href={href(page + 1)} className="inline-flex min-h-11 items-center rounded border border-zinc-300 px-3 py-2 font-medium hover:bg-zinc-100"><PaginationText kind="next" /></Link>}
  </nav>;
}
