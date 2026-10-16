import type { Prisma, PrismaClient } from '@prisma/client';
import { format, parseISO, subMonths } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { CONSULTATION_CREDIT_MONTHS } from '@/app/lib/booking-constants';
import { toPence } from './pricing/money';
import { SALON_TIMEZONE, salonDateKey } from './salon-time';

/**
 * Consultation credit (docs/superpowers/specs/2026-10-16-consultation-credit-pricing-ux-design.md §2):
 * a paid consultation's fee is taken off the consultation-required treatment
 * it was for, once, within CONSULTATION_CREDIT_MONTHS. The rules live in
 * `pickConsultationCredit` over plain rows; `findConsultationCredit` is the
 * query that feeds it. No server-only imports, so the pure parts can be shared.
 */

export type ConsultationCredit = { fromAppointmentId: string; amountPence: number; consultationDate: Date };

/** A consultation booking as the lookup reads it. */
export type ConsultationCreditCandidate = {
  id: string;
  date: Date;
  status: string;
  lateCancelledAt: Date | null;
  /** Decimal pounds (Prisma.Decimal or its exact string form); null = unpriced. */
  priceAtBooking: { toString(): string } | null;
  service: { isConsultation: boolean; isPatchTest: boolean };
  /** Every booking that has recorded this consultation's credit, cancelled ones included. */
  consultationCreditUsedBy: { id: string; status: string }[];
};

/**
 * The earliest instant a consultation may start to give credit to a treatment
 * starting at `at`: salon-local midnight on the same day of the month
 * CONSULTATION_CREDIT_MONTHS earlier (clamped to the month's last day). Whole
 * London calendar days, so a 16 April consultation counts for a 16 October
 * treatment at any hour, in BST or GMT.
 */
export function consultationCreditWindowStart(at: Date): Date {
  // parseISO/subMonths/format all work in the host's local fields, consistently,
  // so the date arithmetic is host-timezone independent.
  const earliestDay = format(subMonths(parseISO(salonDateKey(at)), CONSULTATION_CREDIT_MONTHS), 'yyyy-MM-dd');
  return fromZonedTime(`${earliestDay}T00:00:00.000`, SALON_TIMEZONE);
}

/** Whether the consultation took place: completed, or confirmed, started and not cancelled as a late arrival. */
function tookPlace(row: ConsultationCreditCandidate, now: Date): boolean {
  if (row.status === 'COMPLETED') return true;
  return row.status === 'CONFIRMED' && row.date.getTime() <= now.getTime() && row.lateCancelledAt === null;
}

/** Whether a live booking (not CANCELLED, not the one being edited) already holds this credit. */
function isUsed(row: ConsultationCreditCandidate, excludeAppointmentId: string | undefined): boolean {
  return row.consultationCreditUsedBy.some((use) => use.status !== 'CANCELLED' && use.id !== excludeAppointmentId);
}

/**
 * The most recent unused credit among `rows` (spec §2.2) for a treatment
 * starting at `at`, judged at `now`. Every rule is applied here, whatever the
 * query already narrowed.
 */
export function pickConsultationCredit(
  rows: readonly ConsultationCreditCandidate[],
  options: { at: Date; now: Date; excludeAppointmentId?: string },
): ConsultationCredit | null {
  const earliest = consultationCreditWindowStart(options.at).getTime();
  const latest = options.at.getTime();
  const newestFirst = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  for (const row of newestFirst) {
    if (!row.service.isConsultation && !row.service.isPatchTest) continue;
    if (row.date.getTime() < earliest || row.date.getTime() > latest) continue;
    if (!tookPlace(row, options.now)) continue;
    if (row.priceAtBooking === null) continue;
    const amountPence = toPence(row.priceAtBooking);
    if (amountPence <= 0) continue;
    if (isUsed(row, options.excludeAppointmentId)) continue;
    return { fromAppointmentId: row.id, amountPence, consultationDate: row.date };
  }
  return null;
}

/** The most recent unused consultation credit this customer can put towards a consultation-required booking starting at `at`. */
export async function findConsultationCredit(
  db: Pick<PrismaClient, 'appointment'> | Prisma.TransactionClient,
  input: { userId: string; at: Date; excludeAppointmentId?: string },
): Promise<ConsultationCredit | null> {
  const now = new Date();
  const rows = await db.appointment.findMany({
    where: {
      userId: input.userId,
      service: { OR: [{ isConsultation: true }, { isPatchTest: true }] },
      status: { in: ['COMPLETED', 'CONFIRMED'] },
      date: { gte: consultationCreditWindowStart(input.at), lte: input.at },
    },
    select: {
      id: true,
      date: true,
      status: true,
      lateCancelledAt: true,
      priceAtBooking: true,
      service: { select: { isConsultation: true, isPatchTest: true } },
      consultationCreditUsedBy: { select: { id: true, status: true } },
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  return pickConsultationCredit(rows, { at: input.at, now, excludeAppointmentId: input.excludeAppointmentId });
}

/** The credit to deduct from a treatment priced `treatmentPricePence`: the credit capped at the price, 0 without one. */
export function creditFor(credit: ConsultationCredit | null, treatmentPricePence: number): number {
  if (!credit) return 0;
  return Math.max(0, Math.min(credit.amountPence, treatmentPricePence));
}
