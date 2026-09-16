import type { Prisma, PrismaClient } from '@prisma/client';
import { evaluatePatchTestEligibility, type EligibilityReason } from './patch-test-eligibility';
import { loadExternalBusy } from './external-busy';
import {
  formatSalonTime,
  fitsWithinAvailability,
  resolveSalonDateTime,
  salonDateKey,
  salonDayWindow,
} from './salon-time';
import { overlaps } from './scheduling';

/**
 * Why an admin's drag is questionable — reported rather than thrown.
 *
 * `assertAppointmentSlotAvailable` (booking-service.ts) throws, which is right
 * for the customer path: a customer is simply refused. An admin is *warned* and
 * may proceed anyway, so the UI has to name the specific conflict ("overlaps
 * Mei L. 10:30"), and a thrown error cannot carry that.
 *
 * Both paths share the same primitives — fitsWithinAvailability, loadExternalBusy
 * and overlaps — so the warning an admin sees and the rule a customer hits can't
 * drift apart.
 */
export type MoveClash =
  | { kind: 'OVERLAP'; appointmentId: string; customerName: string | null; start: Date; end: Date }
  | { kind: 'OUTSIDE_HOURS'; availability: { startTime: string; endTime: string } | null }
  | { kind: 'EXTERNAL_BUSY'; source: string; start: Date; end: Date }
  | { kind: 'PATCH_TEST'; reason: EligibilityReason };

type Db = PrismaClient | Prisma.TransactionClient;

export type MoveTarget = {
  /** Excluded from its own overlap scan. */
  appointmentId: string;
  stylistId: string;
  /** Absolute instant of the new start. */
  start: Date;
  durationMin: number;
  /** Owner of the appointment — used for the patch-test history lookup. */
  userId: string;
  requiresPatchTest: boolean;
};

/**
 * Describe everything wrong with moving an appointment to `start` for
 * `durationMin` minutes with `stylistId` — an empty array means the move is
 * clean. Read-only; it never writes and never throws for a business reason.
 *
 * Pass the transaction client when calling this inside the move transaction, so
 * the checks read the same snapshot the write will use.
 */
export async function describeAdminMoveClashes(db: Db, target: MoveTarget): Promise<MoveClash[]> {
  const clashes: MoveClash[] = [];

  // Resolve the instant into the salon's own frame before touching weekday or
  // minutes-of-day. Deriving either from a host-local Date is what produced the
  // wrong-day booking bug.
  const salon = resolveSalonDateTime(salonDateKey(target.start), formatSalonTime(target.start));
  const window = salonDayWindow(target.start);

  const [availability, existing, external] = await Promise.all([
    db.availability.findFirst({
      where: { stylistId: target.stylistId, dayOfWeek: salon.dayOfWeek, isOff: false },
      select: { startTime: true, endTime: true },
    }),
    db.appointment.findMany({
      where: {
        stylistId: target.stylistId,
        date: { gte: window.start, lte: window.end },
        status: { not: 'CANCELLED' },
        id: { not: target.appointmentId },
      },
      select: {
        id: true,
        date: true,
        durationAtBooking: true,
        user: { select: { name: true } },
        service: { select: { duration: true } },
      },
    }),
    loadExternalBusy(db, [target.stylistId], window),
  ]);

  if (!availability) {
    clashes.push({ kind: 'OUTSIDE_HOURS', availability: null });
  } else if (!fitsWithinAvailability(salon.timeMinutes, target.durationMin, availability.startTime, availability.endTime)) {
    clashes.push({ kind: 'OUTSIDE_HOURS', availability });
  }

  for (const row of existing) {
    const durationMin = row.durationAtBooking ?? row.service.duration;
    if (overlaps(target.start, target.durationMin, row.date, durationMin)) {
      clashes.push({
        kind: 'OVERLAP',
        appointmentId: row.id,
        customerName: row.user?.name ?? null,
        start: row.date,
        end: new Date(row.date.getTime() + durationMin * 60_000),
      });
    }
  }

  for (const block of external) {
    const durationMin = Math.max(0, Math.round((block.end.getTime() - block.start.getTime()) / 60_000));
    if (overlaps(target.start, target.durationMin, block.start, durationMin)) {
      clashes.push({ kind: 'EXTERNAL_BUSY', source: 'CALENDAR', start: block.start, end: block.end });
    }
  }

  // Only ask about patch tests when the service actually needs one — this is an
  // extra query on a path that already runs inside a Serializable transaction.
  if (target.requiresPatchTest) {
    const tests = await db.appointment.findMany({
      where: { userId: target.userId, service: { isPatchTest: true } },
      select: { date: true, status: true },
      orderBy: { date: 'desc' },
      take: 20,
    });
    const eligibility = evaluatePatchTestEligibility(tests, target.start);
    if (!eligibility.ok) clashes.push({ kind: 'PATCH_TEST', reason: eligibility.reason });
  }

  return clashes;
}
