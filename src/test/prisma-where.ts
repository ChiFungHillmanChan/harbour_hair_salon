/**
 * A small evaluator for the Prisma `where` shapes the fakes need, with
 * PostgreSQL semantics: `contains` / `startsWith` / `endsWith` are
 * case-sensitive unless `mode: 'insensitive'` is given, `gt`/`gte`/`lt`/`lte`
 * compare dates or numbers, `in` lists values, and AND / OR / NOT nest.
 * NULL follows SQL too: `not: x` never matches a NULL field. A `NOT` over a
 * NULL field throws (SQL's answer is "unknown", which no boolean here can say),
 * as does anything else unsupported, so a fake never silently ignores a filter.
 */
type Where = Record<string, unknown>;

const FIELD_OPERATORS = new Set(['equals', 'contains', 'startsWith', 'endsWith', 'mode', 'in', 'not', 'gt', 'gte', 'lt', 'lte']);

function comparable(value: unknown): number | string | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' || typeof value === 'string') return value;
  return undefined;
}

function fieldMatches(value: unknown, filter: unknown): boolean {
  if (filter === null || typeof filter !== 'object' || filter instanceof Date) {
    return comparable(value) !== undefined ? comparable(value) === comparable(filter) : value === filter;
  }
  const operators = filter as Record<string, unknown>;
  for (const key of Object.keys(operators)) {
    if (!FIELD_OPERATORS.has(key)) throw new Error(`prisma-where: unsupported operator "${key}"`);
  }
  if ('mode' in operators && !['contains', 'startsWith', 'endsWith'].some((key) => key in operators)) {
    throw new Error('prisma-where: `mode` is only modelled with contains / startsWith / endsWith');
  }
  const fold = (text: string) => (operators.mode === 'insensitive' ? text.toLowerCase() : text);
  if ('equals' in operators && !fieldMatches(value, operators.equals)) return false;
  // `x <> 'a'` is unknown, so false, when x is NULL; `not: null` is IS NOT NULL.
  if ('not' in operators && operators.not !== null && value == null) return false;
  if ('not' in operators && fieldMatches(value, operators.not)) return false;
  if ('in' in operators && !(operators.in as unknown[]).some((option) => fieldMatches(value, option))) return false;
  for (const key of ['contains', 'startsWith', 'endsWith'] as const) {
    if (!(key in operators)) continue;
    if (typeof value !== 'string') return false;
    const needle = fold(String(operators[key]));
    const haystack = fold(value);
    if (key === 'contains' && !haystack.includes(needle)) return false;
    if (key === 'startsWith' && !haystack.startsWith(needle)) return false;
    if (key === 'endsWith' && !haystack.endsWith(needle)) return false;
  }
  const actual = comparable(value);
  for (const key of ['gt', 'gte', 'lt', 'lte'] as const) {
    if (!(key in operators)) continue;
    const bound = comparable(operators[key]);
    if (actual === undefined || bound === undefined) return false;
    if (key === 'gt' && !(actual > bound)) return false;
    if (key === 'gte' && !(actual >= bound)) return false;
    if (key === 'lt' && !(actual < bound)) return false;
    if (key === 'lte' && !(actual <= bound)) return false;
  }
  return true;
}

/** Whether `row` satisfies the Prisma `where` object. */
export function matchesWhere<T extends object>(row: T, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, filter]) => {
    if (filter === undefined) return true;
    if (key === 'AND') return [filter].flat().every((part) => matchesWhere(row, part as Where));
    if (key === 'OR') return (filter as Where[]).some((part) => matchesWhere(row, part));
    if (key === 'NOT') {
      return ![filter].flat().some((part) => {
        for (const [field, condition] of Object.entries(part as Where)) {
          if (['AND', 'OR', 'NOT'].includes(field) || condition === null) continue;
          if ((row as Record<string, unknown>)[field] == null) throw new Error(`prisma-where: NOT over the NULL field "${field}" is SQL's unknown; filter it explicitly`);
        }
        return matchesWhere(row, part as Where);
      });
    }
    return fieldMatches((row as Record<string, unknown>)[key], filter);
  });
}
