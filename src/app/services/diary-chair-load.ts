import type { Prisma, PrismaClient } from '@prisma/client';
import type { WorkingHours } from './booking-days';
import type { ChairContext } from './diary-chair-rule';
import { loadExternalBusy, toBookedInterval } from './external-busy';
import type { BookedInterval } from './scheduling';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What the chair rule needs over `window`, read with `db`: the caller's
 * Serializable transaction when it has one, so the rule and the write see one
 * snapshot (spec §6). One query when the window holds no red (UNASSIGNED)
 * diary entry, the usual case: null, the rule has nothing to say. Otherwise
 * the working rows, appointments and busy blocks of every active stylist who
 * takes walk-ins (the chairs; Admin → Stylists).
 * `excludeAppointmentId`: the booking being moved never counts as busy.
 */
export async function loadChairContext(
  db: Db, window: { start: Date; end: Date }, options: { excludeAppointmentId?: string } = {},
): Promise<ChairContext | null> {
  const unassigned = await db.googleDiaryEntry.findMany({
    where: { kind: 'UNASSIGNED', start: { lt: window.end }, end: { gt: window.start } },
    select: { start: true, end: true },
  });
  if (unassigned.length === 0) return null;
  const rows = await db.availability.findMany({
    where: { isOff: false, stylist: { isActive: true, takesWalkIns: true } },
    select: { stylistId: true, dayOfWeek: true, startTime: true, endTime: true },
  });
  const stylistIds = [...new Set(rows.map((row) => row.stylistId))];
  const [appointments, external] = stylistIds.length === 0
    ? [[], []]
    : await Promise.all([
      db.appointment.findMany({
        where: {
          stylistId: { in: stylistIds }, date: { gte: window.start, lte: window.end }, status: { not: 'CANCELLED' },
          ...(options.excludeAppointmentId ? { id: { not: options.excludeAppointmentId } } : {}),
        },
        select: { stylistId: true, date: true, durationAtBooking: true, service: { select: { duration: true } } },
      }),
      loadExternalBusy(db, stylistIds, window),
    ]);
  const hoursByStylist = new Map<string, WorkingHours[]>();
  for (const row of rows) {
    const list = hoursByStylist.get(row.stylistId);
    if (list) list.push(row);
    else hoursByStylist.set(row.stylistId, [row]);
  }
  const busyByStylist = new Map<string, BookedInterval[]>();
  const add = (id: string, interval: BookedInterval) => {
    const list = busyByStylist.get(id);
    if (list) list.push(interval);
    else busyByStylist.set(id, [interval]);
  };
  // Frozen booking duration wins over the live service duration (as getAvailableSlots).
  for (const appointment of appointments) add(appointment.stylistId, { start: appointment.date, durationMin: appointment.durationAtBooking ?? appointment.service.duration });
  for (const block of external) add(block.stylistId, toBookedInterval(block));
  return { unassigned, hoursByStylist, busyByStylist };
}
