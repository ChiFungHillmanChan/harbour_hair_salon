import Link from 'next/link';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Move a (year, month) pair by whole months, rolling the year over correctly. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/**
 * Month navigation for the admin timesheet/payroll pages: prev-next links plus
 * a plain GET form, so the period can be changed without hand-editing the URL.
 * Server-rendered — the form submits natively to `basePath?year=&month=`.
 */
export function MonthSelector({ basePath, year, month }: { basePath: string; year: number; month: number }) {
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const href = (p: { year: number; month: number }) => `${basePath}?year=${p.year}&month=${p.month}`;
  const years = [year - 2, year - 1, year, year + 1];
  const linkClass = 'border border-zinc-300 text-zinc-700 hover:bg-zinc-50 px-3 py-1.5 rounded text-sm whitespace-nowrap';
  const selectClass = 'border border-zinc-300 rounded px-2 py-1.5 text-sm';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={href(prev)} className={linkClass} aria-label={`Previous month: ${MONTH_NAMES[prev.month - 1]} ${prev.year}`}>
        ◀ {MONTH_NAMES[prev.month - 1]}
      </Link>

      <form method="get" action={basePath} className="flex items-center gap-2">
        <label>
          <span className="sr-only">Month</span>
          <select name="month" defaultValue={month} className={selectClass}>
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Year</span>
          <select name="year" defaultValue={year} className={selectClass}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="bg-zinc-900 hover:bg-black text-white px-3 py-1.5 rounded text-sm font-medium transition-colors">
          Go
        </button>
      </form>

      <Link href={href(next)} className={linkClass} aria-label={`Next month: ${MONTH_NAMES[next.month - 1]} ${next.year}`}>
        {MONTH_NAMES[next.month - 1]} ▶
      </Link>
    </div>
  );
}
