import Link from '@/i18n/link';
import { getLocale, getT } from '@/i18n/server';
import { formatMonth, formatMonthName } from '@/i18n/dates';
import { localizeHref } from '@/i18n/paths';

/** Move a (year, month) pair by whole months, rolling the year over correctly. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/**
 * Month navigation for the admin timesheet/payroll pages: prev-next links plus
 * a plain GET form, so the period can be changed without hand-editing the URL.
 * Server-rendered — the form submits natively to `basePath?year=&month=` in the
 * page's language.
 */
export async function MonthSelector({ basePath, year, month }: { basePath: string; year: number; month: number }) {
  const [locale, t] = await Promise.all([getLocale(), getT('admin')]);
  const monthName = (m: number) => formatMonthName(locale, m);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const href = (p: { year: number; month: number }) => `${basePath}?year=${p.year}&month=${p.month}`;
  const years = [year - 2, year - 1, year, year + 1];
  const linkClass = 'border border-zinc-300 text-zinc-700 hover:bg-zinc-50 px-3 py-1.5 rounded text-sm whitespace-nowrap';
  const selectClass = 'border border-zinc-300 rounded px-2 py-1.5 text-sm';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={href(prev)} className={linkClass} aria-label={t('monthSelector.previous', { period: formatMonth(locale, prev.year, prev.month) })}>
        ◀ {monthName(prev.month)}
      </Link>

      <form method="get" action={localizeHref(locale, basePath)} className="flex items-center gap-2">
        <label>
          <span className="sr-only">{t('monthSelector.month')}</span>
          <select name="month" defaultValue={month} className={selectClass}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{monthName(m)}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t('monthSelector.year')}</span>
          <select name="year" defaultValue={year} className={selectClass}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="bg-zinc-900 hover:bg-black text-white px-3 py-1.5 rounded text-sm font-medium transition-colors">
          {t('monthSelector.go')}
        </button>
      </form>

      <Link href={href(next)} className={linkClass} aria-label={t('monthSelector.next', { period: formatMonth(locale, next.year, next.month) })}>
        {monthName(next.month)} ▶
      </Link>
    </div>
  );
}
