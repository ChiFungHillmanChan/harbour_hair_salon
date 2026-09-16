import Link from 'next/link';

export function Pagination({ path, page, hasMore, query = {}, pageKey = "page" }: {
  path: string; page: number; hasMore: boolean; query?: Record<string, string>; pageKey?: string;
}) {
  const href = (next: number) => `${path}?${new URLSearchParams({ ...query, [pageKey]: String(next) })}`;
  if (page === 1 && !hasMore) return null;
  return <nav aria-label="Pagination" className="mt-5 flex items-center gap-5 text-sm">
    {page > 1 && <Link href={href(page - 1)} className="underline">Previous</Link>}
    <span>Page {page}</span>
    {hasMore && <Link href={href(page + 1)} className="underline">Next</Link>}
  </nav>;
}
