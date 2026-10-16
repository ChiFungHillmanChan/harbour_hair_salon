import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../load-server-module';
import { translator } from '../../i18n/messages';
import type { Namespace } from '../../i18n/messages';

type Element = { type: unknown; props: Record<string, unknown> };
type Query = Record<string, string | string[] | undefined>;
type Row = { id: string; date: Date; status: string; paymentAttempt?: unknown; arrivedAt?: Date | null };

/** What the arrivals panel's loader (services/late-arrival-board.ts, tested on its own) hands the page. */
const ARRIVALS = { ruleOn: true, due: [], lateCancelled: [] };
/** The arrivals panel, found by type in the rendered tree. */
const ArrivalsPanel = () => null;

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

async function renderCalendar(query: Query, rows: Row[] = []) {
  const dateQueries: Record<string, Date>[] = [];
  const Calendar = () => null;
  const page = loadServerModule<{ default: (props: { searchParams: Promise<Query> }) => unknown }>('src/app/[locale]/admin/page.tsx', {
    '@/i18n/server': { getLocale: async () => 'en-GB', getT: async (namespace: Namespace) => translator('en-GB', namespace) },
    '@/components/admin/CalendarSetupNotice': { CalendarSetupNotice: () => null },
    '@/app/services/site-settings-service': { getSiteSettings: async () => ({ bookingEnabled: false }) },
    '@/components/admin/ScheduleCalendar': { ScheduleCalendar: Calendar },
    '@/components/admin/LateArrivalPanel': { LateArrivalPanel: ArrivalsPanel },
    '@/app/services/late-arrival-board': { getLateArrivalBoard: async () => ARRIVALS },
    '@/app/lib/session': { requireAdmin: async () => ({ userId: 'admin', role: 'ADMIN' }) },
    '@/app/services/admin-calendar-data': loadServerModule('src/app/services/admin-calendar-data.ts', {
      '@/app/lib/session': { requireAdmin: async () => ({ userId: 'admin', role: 'ADMIN' }) },
    './integration-readiness': { getTreatwellSyncCoverage: async () => ({ warning: null }) },
    '@/app/lib/prisma': { __esModule: true, getDatabaseProvider: () => 'postgresql', default: {
      appointment: {
        findMany: async ({ where }: { where: { date?: Record<string, Date>; status?: string } }) => {
          // Records the calendar's period queries (the pending queue's "not yet started" filter is not one).
          if (where.date?.gte) dateQueries.push(where.date);
          return rows.filter((row) => (!where.status || row.status === where.status) &&
            (!where.date?.gte || row.date >= where.date.gte) &&
            (!where.date?.gt || row.date > where.date.gt) &&
            (!where.date?.lte || row.date <= where.date.lte) &&
            (!where.date?.lt || row.date < where.date.lt)).map((row) => ({ ...row, updatedAt: row.date, stylistId: 'stylist', durationAtBooking: 30, priceAtBooking: 50, user: { name: 'Customer', email: 'customer@example.test' }, service: { name: 'Cut', duration: 30, price: 50, calendarColor: null }, stylist: { name: 'Stylist', calendarColor: null } }));
        },
        groupBy: async () => [],
        count: async ({ where }: { where: { status: string; date?: { gt: Date } } }) =>
          rows.filter(row => row.status === where.status && (!where.date?.gt || row.date > where.date.gt)).length,
      },
      $queryRaw: async () => [Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`month${i}`, rows.filter(row => row.date.getUTCFullYear() === Number(String(query.date).slice(0, 4)) && row.date.getUTCMonth() === i).length]))],
      stylist: { findMany: async () => [] },
      service: { findMany: async () => [] },
      externalBusyBlock: { findMany: async () => [] },
    } },
    }),
  });
  const shell = await page.default({ searchParams: Promise.resolve(query) });
  const content = elements(shell).find((element) => typeof element.type === 'function' && element.type.name === 'ScheduleContent');
  assert.ok(content, 'the dashboard must render its schedule');
  const rendered = await (content.type as (props: Record<string, unknown>) => Promise<unknown>)(content.props);
  const calendar = elements(rendered).find((element) => element.type === Calendar);
  assert.ok(calendar, 'the loaded schedule must reach the calendar');
  return { props: calendar.props, dateQueries, rendered, calendarType: Calendar };
}

test('a booking 75 days ahead is loaded when its day is selected', async () => {
  const date = new Date(Date.now() + 75 * 86_400_000);
  date.setUTCHours(12, 0, 0, 0);
  const result = await renderCalendar({ date: date.toISOString().slice(0, 10), view: 'day' }, [{ id: 'future', date, status: 'PENDING' }]);
  assert.deepEqual((result.props.appointments as Row[]).map((row) => row.id), ['future']);
});

test('historical month navigation fetches that month instead of the current month', async () => {
  const result = await renderCalendar({ date: '2020-01-15', view: 'month' }, [{ id: 'history', date: new Date('2020-01-15T10:00:00Z'), status: 'COMPLETED' }]);
  assert.deepEqual((result.props.appointments as Row[]).map((row) => row.id), ['history']);
});

test('year navigation counts bookings in January and December without loading details', async () => {
  const result = await renderCalendar({ date: '2025-09-16', view: 'year' }, [
    { id: 'january', date: new Date('2025-01-15T10:00:00Z'), status: 'COMPLETED' },
    { id: 'december', date: new Date('2025-12-15T10:00:00Z'), status: 'COMPLETED' },
  ]);
  assert.deepEqual(result.props.appointments, []);
  assert.deepEqual(result.props.monthCounts, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(result.dateQueries, []);
});

test('the pending queue includes every request that can still be answered, regardless of the selected period', async () => {
  const result = await renderCalendar({ date: '2020-01-15', view: 'month' }, [
    // Its time came and went unanswered: it can no longer be confirmed, so it
    // leaves the queue (the notifications cron closes it).
    { id: 'old-request', date: new Date('2021-02-01T10:00:00Z'), status: 'PENDING' },
    { id: 'future-request', date: new Date('2099-12-01T10:00:00Z'), status: 'PENDING' },
    { id: 'next-request', date: new Date('2099-12-08T10:00:00Z'), status: 'PENDING' },
    { id: 'confirmed', date: new Date('2099-12-02T10:00:00Z'), status: 'CONFIRMED' },
  ]);
  assert.deepEqual((result.props.pendingAppointments as Row[] | undefined)?.map((row) => row.id), ['future-request', 'next-request']);
  const pendingCard = elements(result.rendered).find((element) => elements(element.props.children).some((child) => child.props.children === 'Awaiting Confirmation') && elements(element.props.children).some((child) => child.props.children === 2));
  assert.ok(pendingCard, 'the pending count must also include both requests outside the selected period, and only those');
});

test('bookings and pending requests carry their card deposit as a state and an amount, never Square ids', async () => {
  const deposit = (status: string) => ({ status, amountPence: 2000, refunds: [], squarePaymentId: 'square-secret' });
  const result = await renderCalendar({ date: '2099-12-01', view: 'day' }, [
    { id: 'held', date: new Date('2099-12-01T10:00:00Z'), status: 'PENDING', paymentAttempt: deposit('AUTHORIZED') },
    { id: 'paid', date: new Date('2099-12-01T11:00:00Z'), status: 'CONFIRMED', paymentAttempt: deposit('CAPTURED') },
    { id: 'plain', date: new Date('2099-12-01T12:00:00Z'), status: 'CONFIRMED' },
  ] as Row[]);
  const byId = (rows: unknown) => Object.fromEntries((rows as { id: string; deposit: unknown }[]).map((row) => [row.id, row.deposit]));
  assert.deepEqual(byId(result.props.appointments), {
    held: { state: 'HELD', amountPence: 2000 }, paid: { state: 'PAID', amountPence: 2000 }, plain: null,
  });
  assert.deepEqual(byId(result.props.pendingAppointments), { held: { state: 'HELD', amountPence: 2000 } });
  const serialized = JSON.stringify([result.props.appointments, result.props.pendingAppointments]);
  assert.ok(!serialized.includes('square-secret') && !serialized.includes('paymentAttempt'), 'only the deposit view reaches the board');
});

test('the arrivals panel sits above the calendar, and an arrived booking says so on the board', async () => {
  const result = await renderCalendar({ date: '2099-12-01', view: 'day' }, [
    { id: 'arrived', date: new Date('2099-12-01T10:00:00Z'), status: 'CONFIRMED', arrivedAt: new Date('2099-12-01T09:55:00Z') },
    { id: 'expected', date: new Date('2099-12-01T11:00:00Z'), status: 'CONFIRMED' },
  ]);
  const tree = elements(result.rendered);
  const panel = tree.findIndex((element) => element.type === ArrivalsPanel);
  assert.ok(panel >= 0, 'the arrivals panel must be rendered');
  assert.equal(tree[panel].props.board, ARRIVALS);
  assert.ok(panel < tree.findIndex((element) => element.type === result.calendarType), 'the panel comes before the calendar');
  assert.deepEqual(Object.fromEntries((result.props.appointments as { id: string; arrivedAt: unknown }[]).map((row) => [row.id, row.arrivedAt])), {
    arrived: '2099-12-01T09:55:00.000Z', expected: null,
  });
});

test('a request whose time has passed stays on the calendar itself', async () => {
  const result = await renderCalendar({ date: '2021-02-01', view: 'day' }, [{ id: 'old-request', date: new Date('2021-02-01T10:00:00Z'), status: 'PENDING' }]);
  assert.deepEqual((result.props.appointments as Row[]).map((row) => row.id), ['old-request']);
  assert.deepEqual(result.props.pendingAppointments, []);
});

test('day query follows the 23-hour London day when British Summer Time begins', async () => {
  const result = await renderCalendar({ date: '2026-03-29', view: 'day' });
  assert.equal(result.dateQueries[0].gte.toISOString(), '2026-03-29T00:00:00.000Z');
  assert.equal(result.dateQueries[0].lt?.toISOString(), '2026-03-29T23:00:00.000Z');
});

test('month queries include the adjacent days drawn in the calendar grid', async () => {
  const result = await renderCalendar({ date: '2026-09-16', view: 'month' }, [
    { id: 'previous-month', date: new Date('2026-08-30T09:00:00Z'), status: 'CONFIRMED' },
    { id: 'next-month', date: new Date('2026-10-03T09:00:00Z'), status: 'CONFIRMED' },
    { id: 'outside-grid', date: new Date('2026-10-04T09:00:00Z'), status: 'CONFIRMED' },
  ]);
  assert.deepEqual((result.props.appointments as Row[]).map((row) => row.id), ['previous-month', 'next-month']);
});

test('invalid and duplicate query parameters fall back to a valid salon date and default day view', async () => {
  for (const query of [{ date: '2026-02-31', view: 'bogus' }, { date: ['2020-01-01', '2020-02-01'], view: ['day', 'year'] }]) {
    const result = await renderCalendar(query);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    assert.equal(result.props.dateStr, today);
    assert.equal(result.props.view, 'day');
  }
});

function renderClient(dateStr: string, view: string, pendingAppointments: Record<string, unknown>[] = [], appointments: Record<string, unknown>[] = [], locale: 'en-GB' | 'zh-HK' = 'en-GB') {
  const urls: string[] = [];
  const statuses: string[][] = [];
  const calendar = loadServerModule<{ ScheduleCalendar: (props: Record<string, unknown>) => unknown }>('src/components/admin/ScheduleCalendar.tsx', {
    react: { useEffect: () => undefined, useTransition: () => [false, (run: () => void) => run()] },
    // The localized router adds /zh-hk on Chinese pages; the board itself only
    // ever asks for language-free /admin URLs.
    '@/i18n/navigation': { useLocalizedRouter: () => ({ push: (url: string) => urls.push(url), refresh: () => undefined }) },
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace), useLocale: () => locale },
    '@/i18n/draft-store': { useDraftState: (_key: string, initial: unknown) => [initial, () => undefined] },
    './ScheduleDayGrid': { ScheduleDayGrid: () => null },
    './ScheduleWeekGrid': { ScheduleWeekGrid: () => null },
    './AppointmentDialog': { AppointmentDialog: () => null },
    './RescheduleRequestActions': { RescheduleRequestActions: () => null },
    '@/app/actions/admin-schedule': {},
    '@/app/actions/admin': { updateAppointmentStatus: async (id: string, status: string) => { statuses.push([id, status]); return { success: true }; } },
  });
  return { rendered: calendar.ScheduleCalendar({ dateStr, view, appointments, pendingAppointments, rescheduleRequests: [], stylists: [], busyBlocks: [] }), urls, statuses };
}

/** A board row (CalendarAppointment) for the client renderer. */
function boardAppointment(id: string, status: string, date: string) {
  return {
    id, status, date, stylistId: 'stylist', serviceId: 'service', updatedAt: date, durationAtBooking: 60, notes: null,
    rescheduleRequestedDate: null, rescheduleRequestedAt: null, price: { known: false },
    user: { id: `user-${id}`, name: `Customer ${id}`, email: null },
    stylist: { name: 'Stylist', calendarColor: null }, service: { name: 'Cut', duration: 60, calendarColor: null },
  };
}

/** Runs a client handler that uses window.confirm, answering `answer`. */
async function withConfirm(answer: boolean, run: () => unknown) {
  const previous = (globalThis as { window?: unknown }).window;
  const asked: string[] = [];
  (globalThis as { window?: unknown }).window = { confirm: (message: string) => { asked.push(message); return answer; } };
  try {
    await run();
    await new Promise((resolve) => setImmediate(resolve)); // let the status action settle
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
  return asked;
}

const byName = (nodes: Element[], name: string) => nodes.filter((element) => typeof element.type === 'function' && element.type.name === name);
const run = (element: Element) => (element.type as (props: Record<string, unknown>) => unknown)(element.props);

test('Mark completed is offered only once a confirmed booking has started, and asks before completing it', async (t) => {
  // 12:00Z is 13:00 in London (BST) on 16 September.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-16T12:00:00Z') });
  const { rendered, statuses } = renderClient('2026-09-16', 'month', [], [
    boardAppointment('started', 'CONFIRMED', '2026-09-16T11:30:00.000Z'),
    boardAppointment('later', 'CONFIRMED', '2026-09-16T14:00:00.000Z'),
    boardAppointment('done', 'COMPLETED', '2026-09-16T09:00:00.000Z'),
  ]);
  const controls = byName(elements(rendered), 'MarkCompletedButton');
  assert.deepEqual(controls.map((element) => element.props.apptId), ['started'], 'a booking still ahead (or already completed) has no completion control');
  const button = elements(run(controls[0]))[0];
  assert.equal(button.props.children, 'Mark completed');

  const declined = await withConfirm(false, () => (button.props.onClick as () => unknown)());
  assert.deepEqual(declined, ['Mark Customer started’s appointment as completed? This cannot be undone.']);
  assert.deepEqual(statuses, [], 'nothing changes unless the admin confirms');

  await withConfirm(true, () => (button.props.onClick as () => unknown)());
  assert.deepEqual(statuses, [['started', 'COMPLETED']]);
});

// Completing releases a hold nobody took (deposit-lifecycle.ts), so staff
// are told to take the full price; a deposit already taken counts towards it.
test('Mark completed says what becomes of the card deposit before it is confirmed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-16T12:00:00Z') });
  const rows = [
    { ...boardAppointment('held', 'PENDING', '2026-09-16T11:30:00.000Z'), deposit: { state: 'HELD', amountPence: 2000 } },
    { ...boardAppointment('paid', 'CONFIRMED', '2026-09-16T11:00:00.000Z'), deposit: { state: 'PAID', amountPence: 2500 } },
    { ...boardAppointment('plain', 'CONFIRMED', '2026-09-16T10:30:00.000Z'), deposit: null },
  ];
  const expected = {
    'en-GB': {
      held: 'Mark Customer held’s appointment as completed? This cannot be undone. The £20.00 hold will be released — collect the full price in the salon.',
      paid: 'Mark Customer paid’s appointment as completed? This cannot be undone. The £25.00 deposit already paid counts towards the price.',
      plain: 'Mark Customer plain’s appointment as completed? This cannot be undone.',
    },
    'zh-HK': {
      held: '確定將Customer held的預約標示為已完成？此操作無法復原。£20.00 的預留款項會被解除——請於店內收取全數費用。',
      paid: '確定將Customer paid的預約標示為已完成？此操作無法復原。已付的 £25.00 訂金會計入服務價錢。',
      plain: '確定將Customer plain的預約標示為已完成？此操作無法復原。',
    },
  } as const;
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    for (const view of ['month', 'day'] as const) {
      const { rendered } = renderClient('2026-09-16', view, [], rows, locale);
      // The day view's phone list is its own component; the month list is inline.
      const list = view === 'day' ? run(byName(elements(rendered), 'DayView')[0]) : rendered;
      const controls = byName(elements(list), 'MarkCompletedButton');
      assert.deepEqual(controls.map((element) => element.props.apptId).sort(), ['held', 'paid', 'plain'], `${locale} ${view}`);
      for (const control of controls) {
        const button = elements(run(control))[0];
        const asked = await withConfirm(false, () => (button.props.onClick as () => unknown)());
        assert.deepEqual(asked, [expected[locale][control.props.apptId as 'held' | 'paid' | 'plain']], `${locale} ${view} ${String(control.props.apptId)}`);
      }
    }
  }
});

test('a booking request whose time has come offers Decline but not Confirm', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-16T12:00:00Z') });
  const { rendered } = renderClient('2026-09-16', 'month', [], [
    boardAppointment('lapsing', 'PENDING', '2026-09-16T11:00:00.000Z'),
    boardAppointment('open', 'PENDING', '2026-09-16T15:00:00.000Z'),
  ]);
  const actions = byName(elements(rendered), 'PendingActions');
  assert.deepEqual(actions.map((element) => [element.props.apptId, element.props.started]), [['lapsing', true], ['open', false]]);
  const labels = (element: Element) => elements(run(element)).filter((node) => node.type === 'button').map((node) => node.props.children);
  assert.deepEqual(labels(actions[0]), ['Decline']);
  assert.ok(elements(run(actions[0])).some((node) => node.props.children === 'Time passed — can no longer be confirmed'));
  assert.deepEqual(labels(actions[1]), ['Confirm booking', 'Decline']);
});

// The lapse step leaves a request open until its appointment ends, because the
// customer may be in the chair (often a staff pencil-in): staff can record the
// visit as completed instead of leaving it to be cancelled.
test('a booking request whose time has come can be marked completed, on the month list and the phone day list', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-16T12:00:00Z') });
  const rows = [
    boardAppointment('in-the-chair', 'PENDING', '2026-09-16T11:30:00.000Z'),
    boardAppointment('open', 'PENDING', '2026-09-16T15:00:00.000Z'),
    boardAppointment('declined', 'CANCELLED', '2026-09-16T11:00:00.000Z'),
  ];
  const month = renderClient('2026-09-16', 'month', [], rows);
  const monthControls = byName(elements(month.rendered), 'MarkCompletedButton');
  assert.deepEqual(monthControls.map((element) => element.props.apptId), ['in-the-chair']);
  const button = elements(run(monthControls[0]))[0];
  await withConfirm(true, () => (button.props.onClick as () => unknown)());
  assert.deepEqual(month.statuses, [['in-the-chair', 'COMPLETED']]);

  const day = renderClient('2026-09-16', 'day', [], rows);
  const [list] = byName(elements(day.rendered), 'DayView');
  assert.ok(list, 'the phone day list is rendered');
  assert.deepEqual(byName(elements(run(list)), 'MarkCompletedButton').map((element) => element.props.apptId), ['in-the-chair']);
});

test('calendar arrows request another server-loaded month via the URL', () => {
  const { rendered, urls } = renderClient('2026-12-01', 'month');
  const next = elements(rendered).find((element) => element.type === 'button' && String(element.props.children).trim() === '→');
  assert.ok(next);
  (next.props.onClick as () => void)();
  assert.deepEqual(urls, ['/admin?date=2027-01-01&view=month']);
});

test('the week arrows step a whole week, not a day or a month', () => {
  const { rendered, urls } = renderClient('2026-12-01', 'week');
  const next = elements(rendered).find((element) => element.props['aria-label'] === 'Next period');
  assert.ok(next);
  (next.props.onClick as () => void)();
  const previous = elements(rendered).find((element) => element.props['aria-label'] === 'Previous period');
  assert.ok(previous);
  (previous.props.onClick as () => void)();
  assert.deepEqual(urls, ['/admin?date=2026-12-08&view=week', '/admin?date=2026-11-24&view=week']);
});

test('every period is offered in the toolbar, week included', () => {
  const { rendered } = renderClient('2026-12-01', 'week');
  const buttons = elements(rendered).filter((element) => element.type === 'button' && typeof element.props.children === 'string');
  const periods = buttons.map((element) => element.props.children).filter((label) => ['day', 'week', 'month', 'year'].includes(label as string));
  assert.deepEqual(periods, ['day', 'week', 'month', 'year']);
  const active = buttons.filter((element) => element.props['aria-pressed'] === true).map((element) => element.props.children);
  assert.deepEqual(active, ['week'], 'the selected period must be the one the server resolved');
});

test('day and year arrows preserve their requested view in the server URL', () => {
  for (const [view, expected] of [['day', '/admin?date=2026-12-02&view=day'], ['year', '/admin?date=2027-12-01&view=year']]) {
    const { rendered, urls } = renderClient('2026-12-01', view);
    const next = elements(rendered).find((element) => element.props['aria-label'] === 'Next period');
    assert.ok(next);
    (next.props.onClick as () => void)();
    assert.deepEqual(urls, [expected]);
  }
});

test('an outstanding request outside the current month can be opened and approved from the global queue', async (t) => {
  // A request can only be approved before its time, so pin "now" ahead of it.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-16T12:00:00Z') });
  const { rendered, urls, statuses } = renderClient('2026-09-16', 'month', [{
    id: 'future-request', date: new Date('2026-11-30T10:00:00Z'), status: 'PENDING',
    user: { name: 'Future Customer' }, stylist: { name: 'Stylist' }, service: { name: 'Cut' },
  }]);
  const queue = elements(rendered).find((element) => element.props['aria-label'] === 'All pending booking requests');
  assert.ok(queue);
  const open = elements(queue).find((element) => element.type === 'button');
  assert.ok(open);
  (open.props.onClick as () => void)();
  assert.deepEqual(urls, ['/admin?date=2026-11-30&view=day']);
  const actions = elements(queue).find((element) => typeof element.type === 'function' && element.type.name === 'PendingActions');
  assert.ok(actions);
  const buttons = (actions.type as (props: Record<string, unknown>) => unknown)(actions.props);
  const approve = elements(buttons).find((element) => element.props.children === 'Confirm booking');
  assert.ok(approve);
  await (approve.props.onClick as () => Promise<void>)();
  assert.deepEqual(statuses, [['future-request', 'CONFIRMED']]);
});

test('the Chinese board translates its periods and controls but keeps language-free navigation URLs', () => {
  const urls: string[] = [];
  const calendar = loadServerModule<{ ScheduleCalendar: (props: Record<string, unknown>) => unknown }>('src/components/admin/ScheduleCalendar.tsx', {
    react: { useEffect: () => undefined, useTransition: () => [false, (run: () => void) => run()] },
    '@/i18n/navigation': { useLocalizedRouter: () => ({ push: (url: string) => urls.push(url), refresh: () => undefined }) },
    '@/i18n/client': { useT: (namespace: Namespace) => translator('zh-HK', namespace), useLocale: () => 'zh-HK' },
    '@/i18n/draft-store': { useDraftState: (_key: string, initial: unknown) => [initial, () => undefined] },
    './ScheduleDayGrid': { ScheduleDayGrid: () => null },
    './ScheduleWeekGrid': { ScheduleWeekGrid: () => null },
    './AppointmentDialog': { AppointmentDialog: () => null },
    './RescheduleRequestActions': { RescheduleRequestActions: () => null },
    '@/app/actions/admin-schedule': {},
    '@/app/actions/admin': {},
  });
  const rendered = calendar.ScheduleCalendar({ dateStr: '2026-12-01', view: 'month', appointments: [], pendingAppointments: [], rescheduleRequests: [], stylists: [], busyBlocks: [] });
  const nodes = elements(rendered);
  const periods = nodes.filter((element) => element.type === 'button' && element.props['aria-pressed'] !== undefined).map((element) => element.props.children);
  assert.deepEqual(periods, ['日', '週', '月', '年']);
  assert.ok(nodes.some((element) => element.type === 'h2' && element.props.children === '2026年12月'), 'the month title follows the page language');
  const next = nodes.find((element) => element.props['aria-label'] === '下一段時間');
  assert.ok(next);
  (next.props.onClick as () => void)();
  assert.deepEqual(urls, ['/admin?date=2027-01-01&view=month']);
});

test('the day list shows a booking’s recorded consultation credit, in both languages', () => {
  const text = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join(' ');
    if (!node || typeof node !== 'object' || !('props' in node)) return '';
    return text((node as Element).props.children);
  };
  const row = { ...boardAppointment('treatment', 'CONFIRMED', '2026-09-16T14:00:00.000Z'), consultationCredit: { amountPence: 1500, consultationDate: '2026-09-01T10:00:00.000Z' } };
  const plain = boardAppointment('plain', 'CONFIRMED', '2026-09-16T15:00:00.000Z');
  // Final review M2: a cancelled booking deducts nothing, so it shows no credit.
  const cancelled = { ...boardAppointment('cancelled', 'CANCELLED', '2026-09-16T16:00:00.000Z'), consultationCredit: { amountPence: 1500, consultationDate: '2026-09-01T10:00:00.000Z' } };
  for (const [locale, words] of [['en-GB', 'Consultation credit −£15.00'], ['zh-HK', '諮詢費抵扣 −£15.00']] as const) {
    const { rendered } = renderClient('2026-09-16', 'day', [], [row, plain, cancelled], locale);
    const days = byName(elements(rendered), 'DayView');
    assert.equal(days.length, 1);
    const shown = text(run(days[0]));
    assert.equal(shown.split(words).length - 1, 1, 'once, for the live booking that has a credit only');
  }
});
