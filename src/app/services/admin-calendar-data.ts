import 'server-only';
import { Prisma } from '@prisma/client';
import prisma, { getDatabaseProvider } from '@/app/lib/prisma';
import { requireAdmin } from '@/app/lib/session';
import { dateCursor, encodeDateCursor } from '@/app/lib/pagination';
import { resolveAdminCalendarRange, type CalendarQuery } from './admin-calendar-range';
import { resolveSalonDateTime } from './salon-time';
import { getTreatwellSyncCoverage } from './integration-readiness';
import { recordedPrice } from './pricing/recorded-price';
import { toPence } from './pricing/money';
import { isRescheduleRequestMoot } from '@/app/lib/reschedule-request';
import type { BoardPrice } from '@/app/lib/board-price';
import { adminDepositView, adminDepositViewSelect, depositView, depositViewSelect } from '@/app/lib/deposit-display';
import { parseDiaryStylistIds } from '@/app/lib/calendar-diary-display';
import type { DiaryKind } from './google-diary-classify';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import { loadPublishedTranslations, overlay } from './content/translations';
import type { ContentFields } from './content/fields';

// The service's CURRENT price is deliberately not selected: an appointment
// shows only the price recorded when it was booked (unknown when none was).
export const calendarAppointmentSelect = {
  id: true, date: true, status: true, stylistId: true, serviceId: true, updatedAt: true,
  durationAtBooking: true, priceAtBooking: true, quoteJson: true, notes: true,
  rescheduleRequestedDate: true, rescheduleRequestedAt: true, arrivedAt: true,
  user: { select: { id: true, name: true, email: true } },
  stylist: { select: { name: true, calendarColor: true, googleColorId: true } },
  service: { select: { name: true, duration: true, calendarColor: true } },
  // The card deposit's state (deposit-display.ts) and our own refund ids —
  // a refund staff may mark settled outside the website — never Square ids.
  paymentAttempt: { select: adminDepositViewSelect },
  // The consultation credit staff applied (consultation-credit.ts): the dialog shows it.
  consultationCreditPence: true,
  consultationCreditFrom: { select: { date: true } },
} satisfies Prisma.AppointmentSelect;

type CalendarRow = Prisma.AppointmentGetPayload<{ select: typeof calendarAppointmentSelect }>;

function boardPrice(row: Pick<CalendarRow, 'priceAtBooking' | 'quoteJson'>): BoardPrice {
  const recorded = recordedPrice(row);
  if (!recorded.known) return { known: false };
  const { amountPence, priceType, vatDisplay, priceNature } = recorded;
  return { known: true, amountPence, priceType, vatDisplay, priceNature };
}

export function serializeCalendarAppointment(row: CalendarRow, includeContact = true) {
  return {
    id: row.id, date: row.date.toISOString(), status: row.status, stylistId: row.stylistId,
    serviceId: row.serviceId, updatedAt: row.updatedAt.toISOString(),
    durationAtBooking: row.durationAtBooking, notes: row.notes,
    rescheduleRequestedDate: row.rescheduleRequestedDate?.toISOString() ?? null,
    rescheduleRequestedAt: row.rescheduleRequestedAt?.toISOString() ?? null,
    // Staff marked the customer arrived (late-arrival rule): the grid shows it, the dialog toggles it.
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    price: boardPrice(row),
    deposit: adminDepositView(row.paymentAttempt),
    consultationCredit: row.consultationCreditPence !== null && row.consultationCreditFrom
      ? { amountPence: row.consultationCreditPence, consultationDate: row.consultationCreditFrom.date.toISOString() }
      : null,
    user: { id: row.user.id, name: row.user.name, email: includeContact ? row.user.email : null },
    stylist: row.stylist,
    service: row.service,
  };
}
export type CalendarAppointment = ReturnType<typeof serializeCalendarAppointment>;

/**
 * The booking dialog's service menu. Every service is loaded so an existing
 * appointment on a retired option still names it, but only `isBookable` rows
 * are offered for new bookings or service changes. Price fields are what the
 * dialog shows and echoes back as the expected quote.
 */
const dialogServiceSelect = {
  id: true, name: true, duration: true, price: true, category: true, requiresPatchTest: true, requiresConsultation: true,
  priceVersion: true, priceType: true, hairLength: true, vatDisplay: true, priceNature: true,
  isBookable: true, offeringId: true, offering: { select: { name: true } },
} satisfies Prisma.ServiceSelect;
type DialogServiceRow = Prisma.ServiceGetPayload<{ select: typeof dialogServiceSelect }>;

function serializeDialogService({ price, offering, ...row }: DialogServiceRow, serviceFields?: ContentFields, offeringFields?: ContentFields) {
  const localized = overlay(row, serviceFields, ['name']);
  const localizedOffering = offering ? overlay(offering, offeringFields, ['name']) : null;
  return {
    ...localized,
    searchText: `${row.name} ${localized.name}`,
    offering: localizedOffering ? { name: localizedOffering.name, searchText: `${offering!.name} ${localizedOffering.name}` } : null,
    amountPence: toPence(price),
  };
}
export type CalendarDialogService = ReturnType<typeof serializeDialogService>;

const pendingSelect = {
  id: true, date: true, status: true,
  user: { select: { name: true } },
  stylist: { select: { name: true } },
  service: { select: { name: true } },
  paymentAttempt: { select: depositViewSelect },
} satisfies Prisma.AppointmentSelect;
type PendingRow = Prisma.AppointmentGetPayload<{ select: typeof pendingSelect }>;

function serializePending({ paymentAttempt, date, ...row }: PendingRow) {
  return { ...row, date: date.toISOString(), deposit: depositView(paymentAttempt) };
}
export type PendingAppointment = ReturnType<typeof serializePending>;

const rescheduleRequestSelect = {
  id: true, date: true, rescheduleRequestedDate: true, rescheduleRequestedAt: true,
  user: { select: { name: true, phone: true } },
  stylist: { select: { name: true } },
  service: { select: { name: true } },
} satisfies Prisma.AppointmentSelect;

/** One aggregate statement, twelve London month boundaries, no per-booking payload. */
async function yearCounts(year: number) {
  const bounds = Array.from({ length: 13 }, (_, month) =>
    resolveSalonDateTime(`${year + Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}-01`, '00:00').utc);
  // Prisma binds PostgreSQL raw Date parameters as timestamptz, while this
  // schema stores DateTime as timestamp without time zone in UTC. Normalize
  // the parameter explicitly; an implicit cast uses the DB session timezone
  // and otherwise puts London midnight in the previous month. SQLite stores
  // epoch milliseconds and SQL Server binds datetime2, so keep their Date bind.
  const provider = getDatabaseProvider();
  const sqlBounds = bounds.map(date => provider === 'postgresql'
    ? Prisma.sql`(${date} AT TIME ZONE 'UTC')` : Prisma.sql`${date}`);
  const columns = sqlBounds.slice(0, 12).map((start, month) => Prisma.sql`
    COUNT(CASE WHEN "date" >= ${start} AND "date" < ${sqlBounds[month + 1]} THEN 1 END) AS ${Prisma.raw(`"month${month}"`)}
  `);
  const [row] = await prisma.$queryRaw<Record<string, number | bigint>[]>(Prisma.sql`
    SELECT ${Prisma.join(columns)} FROM "Appointment" WHERE "date" >= ${sqlBounds[0]} AND "date" < ${sqlBounds[12]}
  `);
  return Array.from({ length: 12 }, (_, month) => Number(row?.[`month${month}`] ?? 0));
}

export async function getAdminCalendarData(query: CalendarQuery & { pending?: string | string[] }, locale: Locale = DEFAULT_LOCALE) {
  await requireAdmin();
  const now = new Date();
  const { dateStr, view, range } = resolveAdminCalendarRange(query, now);
  const todayRange = resolveAdminCalendarRange({ view: 'day' }, now).range;
  const cursor = dateCursor(query.pending);
  const [appointments, todayStats, syncCoverage, stylists, busyBlocks, diaryRows, pendingRows, pendingCount, monthCounts, services, rescheduleRows] = await Promise.all([
    view === 'year' ? Promise.resolve([]) : prisma.appointment.findMany({
      where: { date: range },
      select: { ...calendarAppointmentSelect, user: { select: { id: true, name: true, email: view === 'day' } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    }),
    prisma.appointment.groupBy({ by: ['status'], where: { date: todayRange }, _count: true }),
    getTreatwellSyncCoverage(),
    view === 'year' ? Promise.resolve([]) : prisma.stylist.findMany({
      where: { isActive: true }, orderBy: { name: 'asc' },
      select: { id: true, name: true, calendarColor: true, googleColorId: true, availabilities: { select: { dayOfWeek: true, startTime: true, endTime: true, isOff: true } } },
    }),
    view !== 'day' && view !== 'week' ? Promise.resolve([]) : prisma.externalBusyBlock.findMany({
      // Google's own busy time is drawn from the diary entries below (diary mirror spec §9).
      where: { source: { not: 'GOOGLE' }, start: { lt: range.lt }, end: { gt: range.gte } },
      select: { id: true, stylistId: true, source: true, summary: true, start: true, end: true, lastSyncAt: true },
    }),
    view !== 'day' && view !== 'week' ? Promise.resolve([]) : prisma.googleDiaryEntry.findMany({
      where: { start: { lt: range.lt }, end: { gt: range.gte } },
      select: { id: true, kind: true, stylistIdsJson: true, title: true, colorId: true, start: true, end: true, allDay: true, htmlLink: true },
      orderBy: [{ start: 'asc' }, { id: 'asc' }],
    }),
    // Only requests that can still be answered: once a request's time has come
    // it cannot be confirmed and the notifications cron closes it
    // (pending-request-lapse.ts). The calendar views above still show it.
    prisma.appointment.findMany({
      where: { status: 'PENDING', date: { gt: now }, ...(cursor ? { OR: [{ date: { gt: cursor.date } }, { date: cursor.date, id: { gt: cursor.id } }] } : {}) },
      select: pendingSelect, orderBy: [{ date: 'asc' }, { id: 'asc' }], take: 26,
    }),
    prisma.appointment.count({ where: { status: 'PENDING', date: { gt: now } } }),
    view === 'year' ? yearCounts(Number(dateStr.slice(0, 4))) : Promise.resolve([]),
    // The booking dialog's service menu. Small and admin-only, but still skipped
    // on the year view, which deliberately loads counts and nothing else.
    view === 'year' ? Promise.resolve([]) : prisma.service.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: dialogServiceSelect,
    }),
    prisma.appointment.findMany({
      where: { status: 'CONFIRMED', rescheduleRequestedDate: { not: null } },
      select: rescheduleRequestSelect, orderBy: [{ rescheduleRequestedAt: 'asc' }, { id: 'asc' }], take: 50,
    }),
  ]);
  const [serviceTranslations, offeringTranslations] = await Promise.all([
    loadPublishedTranslations(prisma, 'SERVICE', services.map((row) => row.id), locale),
    loadPublishedTranslations(prisma, 'SERVICE_OFFERING', services.flatMap((row) => row.offeringId ? [row.offeringId] : []), locale),
  ]);
  const page = pendingRows.slice(0, 25);
  return {
    dateStr, view, todayStats, syncCoverage, stylists, pendingCount, monthCounts, loadedAt: new Date().toISOString(),
    services: services.map((row) => serializeDialogService(row, serviceTranslations.get(row.id), row.offeringId ? offeringTranslations.get(row.offeringId) : undefined)),
    periodCount: view === 'year' ? monthCounts.reduce((sum, count) => sum + count, 0) : appointments.length,
    appointments: appointments.map((row) => serializeCalendarAppointment(row, view === 'day')),
    busyBlocks: busyBlocks.map((row) => ({ ...row, start: row.start.toISOString(), end: row.end.toISOString(), lastSyncAt: row.lastSyncAt.toISOString() })),
    diaryEntries: diaryRows.map(({ stylistIdsJson, kind, start, end, ...row }) => ({
      ...row, kind: kind as DiaryKind, stylistIds: parseDiaryStylistIds(stylistIdsJson), start: start.toISOString(), end: end.toISOString(),
    })),
    pendingAppointments: page.map(serializePending),
    pendingNext: pendingRows.length > 25 ? encodeDateCursor(page[page.length - 1]) : null,
    pendingHasPrevious: Boolean(cursor),
    rescheduleRequests: rescheduleRows.filter((row) => row.rescheduleRequestedDate && row.rescheduleRequestedAt).map((row) => ({
      id: row.id, date: row.date.toISOString(),
      requestedDate: row.rescheduleRequestedDate!.toISOString(), requestedAt: row.rescheduleRequestedAt!.toISOString(),
      // Requested time under 24 h away, or the visit itself has already happened.
      expired: isRescheduleRequestMoot({ date: row.date, rescheduleRequestedDate: row.rescheduleRequestedDate! }, now),
      user: row.user, stylist: row.stylist, service: row.service,
    })),
    rescheduleRequestCount: rescheduleRows.filter((row) => row.rescheduleRequestedDate && !isRescheduleRequestMoot({ date: row.date, rescheduleRequestedDate: row.rescheduleRequestedDate }, now)).length,
  };
}

export type RescheduleRequestRow = Awaited<ReturnType<typeof getAdminCalendarData>>['rescheduleRequests'][number];
