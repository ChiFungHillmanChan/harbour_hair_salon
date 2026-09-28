/**
 * Money is carried as integer pence from the database edge to the display
 * edge. A Prisma Decimal is converted through its exact string form, never
 * through a float, so £44.99 cannot become 4498p.
 */
export type Pence = number;

export function toPence(value: { toString(): string } | number | string): Pence {
  const text = typeof value === 'number' ? value.toFixed(2) : value.toString().trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Not a money amount: ${text}`);
  const [, sign, whole, fraction = ''] = match;
  const padded = (fraction + '000').slice(0, 3);
  // Round half away from zero on the third decimal (Decimal columns may hold more).
  let pence = Number(whole) * 100 + Number(padded.slice(0, 2)) + (Number(padded[2]) >= 5 ? 1 : 0);
  if (sign) pence = -pence;
  return pence;
}

/** For Prisma Decimal writes: an exact two-decimal string. */
export function penceToDecimalString(pence: Pence): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(pence);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function penceToNumber(pence: Pence): number {
  return pence / 100;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** "£157.00" in both languages; whole pounds may drop the pence ("£157"). */
export function formatGBP(pence: Pence, locale: string, options: { wholePounds?: boolean } = {}): string {
  const drop = options.wholePounds && pence % 100 === 0;
  const key = `${locale}|${drop}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: drop ? 0 : 2,
      maximumFractionDigits: drop ? 0 : 2,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(pence / 100);
}
