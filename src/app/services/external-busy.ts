import type { PrismaClient, Prisma } from '@prisma/client';
import type { BookedInterval } from './scheduling';

export type ExternalBlockRow = { stylistId: string; start: Date; end: Date };

const durationMin = (start: Date, end: Date) =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

/** Shape consumed by the firstFreeStylist / createBooking conflict checks. */
export function toBookedInterval(row: ExternalBlockRow): BookedInterval {
  return { start: row.start, durationMin: durationMin(row.start, row.end) };
}

/** Shape consumed by buildStylistSlots (a pseudo-appointment). */
export function toSlotAppointment(row: ExternalBlockRow): {
  date: Date;
  service: { duration: number };
} {
  return { date: row.start, service: { duration: durationMin(row.start, row.end) } };
}

/** Prisma client or a `$transaction` client — both expose externalBusyBlock. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Load external busy blocks for the given stylists overlapping [window.start,
 * window.end]. Overlap = block.start <= window.end AND block.end >= window.start.
 * `db` may be the Prisma client or a `$transaction` client.
 */
export async function loadExternalBusy(
  db: Db,
  stylistIds: string[],
  window: { start: Date; end: Date },
): Promise<ExternalBlockRow[]> {
  if (stylistIds.length === 0) return [];
  return db.externalBusyBlock.findMany({
    where: {
      stylistId: { in: stylistIds },
      start: { lte: window.end },
      end: { gte: window.start },
    },
    select: { stylistId: true, start: true, end: true },
  });
}
