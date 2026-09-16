/** Invalid or duplicated query values always return the first bounded page. */
export function pageNumber(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,3}$/.test(value)) return 1;
  return Number(value);
}

export function searchText(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

export function dateCursor(value: string | string[] | undefined): { date: Date; id: string } | null {
  if (typeof value !== 'string' || value.length > 400) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 128 || typeof parsed.date !== 'string') return null;
    const date = new Date(parsed.date);
    return Number.isFinite(date.getTime()) ? { date, id: parsed.id } : null;
  } catch { return null; }
}

export function encodeDateCursor(row: { id: string; date: Date }): string {
  return Buffer.from(JSON.stringify({ id: row.id, date: row.date.toISOString() })).toString('base64url');
}
