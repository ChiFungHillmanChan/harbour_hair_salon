import 'server-only';
import { Prisma } from '@prisma/client';
import prisma, { getDatabaseProvider } from '@/app/lib/prisma';
import { requireAdmin } from '@/app/lib/session';
import { dateCursor, encodeDateCursor } from '@/app/lib/pagination';
import { resolveAdminCalendarRange, type CalendarQuery } from './admin-calendar-range';
import { resolveSalonDateTime } from './salon-time';
import { getTreatwellSyncCoverage } from './integration-readiness';

export const calendarAppointmentSelect = {
  id: true, date: true, status: true, stylistId: true, serviceId: true, updatedAt: true,
  durationAtBooking: true, priceAtBooking: true, notes: true,
  user: { select: { id: true, name: true, email: true } },
  stylist: { select: { name: true, calendarColor: true } },
  service: { select: { name: true, duration: true, price: true, calendarColor: true } },
} satisfies Prisma.AppointmentSelect;

type CalendarRow = Prisma.AppointmentGetPayload<{ select: typeof calendarAppointmentSelect }>;
export function serializeCalendarAppointment(row: CalendarRow, includeContact = true) {
  return {
    id: row.id, date: row.date.toISOString(), status: row.status, stylistId: row.stylistId,
    serviceId: row.serviceId, updatedAt: row.updatedAt.toISOString(),
    durationAtBooking: row.durationAtBooking, notes: row.notes,
    priceAtBooking: row.priceAtBooking === null ? null : Number(row.priceAtBooking),
    user: { id: row.user.id, name: row.user.name, email: includeContact ? row.user.email : null },
    stylist: row.stylist,
    service: { ...row.service, price: Number(row.service.price) },
  };
}
export type CalendarAppointment = ReturnType<typeof serializeCalendarAppointment>;

const pendingSelect = {
  id: true, date: true, status: true,
  user: { select: { name: true } },
  stylist: { select: { name: true } },
  service: { select: { name: true } },
} satisfies Prisma.AppointmentSelect;
type PendingRow = Prisma.AppointmentGetPayload<{ select: typeof pendingSelect }>;
export type PendingAppointment = Omit<PendingRow, 'date'> & { date: string };

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

export async function getAdminCalendarData(query: CalendarQuery & { pending?: string | string[] }) {
  await requireAdmin();
  const now = new Date();
  const { dateStr, view, range } = resolveAdminCalendarRange(query, now);
  const todayRange = resolveAdminCalendarRange({ view: 'day' }, now).range;
  const cursor = dateCursor(query.pending);
  const [appointments, todayStats, syncCoverage, stylists, busyBlocks, pendingRows, pendingCount, monthCounts, services] = await Promise.all([
    view === 'year' ? Promise.resolve([]) : prisma.appointment.findMany({
      where: { date: range },
      select: { ...calendarAppointmentSelect, user: { select: { id: true, name: true, email: view === 'day' } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    }),
    prisma.appointment.groupBy({ by: ['status'], where: { date: todayRange }, _count: true }),
    getTreatwellSyncCoverage(),
    view === 'year' ? Promise.resolve([]) : prisma.stylist.findMany({
      where: { isActive: true }, orderBy: { name: 'asc' },
      select: { id: true, name: true, calendarColor: true, availabilities: { select: { dayOfWeek: true, startTime: true, endTime: true, isOff: true } } },
    }),
    view !== 'day' && view !== 'week' ? Promise.resolve([]) : prisma.externalBusyBlock.findMany({
      where: { start: { lt: range.lt }, end: { gt: range.gte } },
      select: { id: true, stylistId: true, source: true, start: true, end: true, lastSyncAt: true },
    }),
    prisma.appointment.findMany({
      where: { status: 'PENDING', ...(cursor ? { OR: [{ date: { gt: cursor.date } }, { date: cursor.date, id: { gt: cursor.id } }] } : {}) },
      select: pendingSelect, orderBy: [{ date: 'asc' }, { id: 'asc' }], take: 26,
    }),
    prisma.appointment.count({ where: { status: 'PENDING' } }),
    view === 'year' ? yearCounts(Number(dateStr.slice(0, 4))) : Promise.resolve([]),
    // The booking dialog's service menu. Small and admin-only, but still skipped
    // on the year view, which deliberately loads counts and nothing else.
    view === 'year' ? Promise.resolve([]) : prisma.service.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, duration: true, price: true, category: true, requiresPatchTest: true },
    }),
  ]);
  const page = pendingRows.slice(0, 25);
  return {
    dateStr, view, todayStats, syncCoverage, stylists, pendingCount, monthCounts,
    services: services.map((row) => ({ ...row, price: Number(row.price) })),
    periodCount: view === 'year' ? monthCounts.reduce((sum, count) => sum + count, 0) : appointments.length,
    appointments: appointments.map((row) => serializeCalendarAppointment(row, view === 'day')),
    busyBlocks: busyBlocks.map((row) => ({ ...row, start: row.start.toISOString(), end: row.end.toISOString(), lastSyncAt: row.lastSyncAt.toISOString() })),
    pendingAppointments: page.map((row) => ({ ...row, date: row.date.toISOString() })),
    pendingNext: pendingRows.length > 25 ? encodeDateCursor(page[page.length - 1]) : null,
    pendingHasPrevious: Boolean(cursor),
  };
}
