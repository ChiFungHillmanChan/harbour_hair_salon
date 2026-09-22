import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const hooks = {
  useMemo: (run: () => unknown) => run(),
  useState: (value: unknown) => [value, () => undefined],
  useRef: (value: unknown) => ({ current: value }),
};
function render(view: 'Day' | 'Week', source: string, start: string, end: string, dayKey = '2026-10-23', duplicate = false) {
  const grid = loadServerModule<Record<string, (props: Record<string, unknown>) => unknown>>(
    `src/components/admin/Schedule${view}Grid.tsx`, { react: hooks },
  );
  return elements(grid[`Schedule${view}Grid`]({
    day: new Date(`${dayKey}T12:00:00Z`), dayKeys: [dayKey], todayKey: dayKey,
    stylists: [{ id: 's1', name: 'Funky', calendarColor: null, availability: null, availabilityByWeekday: {} }],
    appointments: [], busyBlocks: [
      { id: 'external', stylistId: 's1', source, start, end, lastSyncAt: '2026-09-20T00:00:00Z' },
      ...(duplicate ? [{ id: 'second', stylistId: 's2', source: 'FRESHA', start, end, lastSyncAt: '2026-09-20T00:00:00Z' }] : []),
    ],
  }));
}

test('week calendar places simultaneous external bookings beside each other', () => {
  const notes = render('Week', 'TREATWELL', '2026-10-23T13:00:00Z', '2026-10-23T14:00:00Z', '2026-10-23', true)
    .filter(node => node.props.role === 'note');
  assert.equal(notes.length, 2);
  const styles = notes.map(node => node.props.style as { left: string; width: string });
  assert.notEqual(styles[0].left, styles[1].left);
  assert.deepEqual(styles.map(style => style.width), ['50%', '50%']);
});

for (const view of ['Day', 'Week'] as const) {
  for (const [source, label] of [['FRESHA', 'Fresha'], ['TREATWELL', 'Treatwell']]) {
    test(`${view} calendar identifies ${label}, stylist and London booking times`, () => {
      const nodes = render(view, source, '2026-10-23T13:00:00Z', '2026-10-23T13:15:00Z');
      assert.ok(nodes.some(node => String(node.props['aria-label']).includes(`${label} · Funky · 14:00–14:15`)));
      assert.ok(nodes.some(node => node.props.children === label), 'the provider is visible, not only a hover title');
      assert.ok(nodes.some(node => node.props.children === '14:00–14:15'), 'the time range is visible');
    });
  }
  test(`${view} calendar keeps the following-day part of an overnight imported booking visible`, () => {
    const nodes = render(view, 'TREATWELL', '2026-10-22T22:30:00Z', '2026-10-23T01:00:00Z');
    assert.ok(nodes.some(node => String(node.props['aria-label']).includes('00:00–02:00')));
  });
  test(`${view} calendar shows an all-day block across the autumn clock change and excludes its end boundary`, () => {
    const nodes = render(view, 'FRESHA', '2026-10-24T23:00:00Z', '2026-10-26T00:00:00Z', '2026-10-25');
    assert.ok(nodes.some(node => String(node.props['aria-label']).includes('00:00–24:00')));
    const after = render(view, 'FRESHA', '2026-10-24T23:00:00Z', '2026-10-26T00:00:00Z', '2026-10-26');
    assert.ok(!after.some(node => node.props.role === 'note'));
  });
}

for (const view of ['day', 'week']) {
  test(`mobile ${view} agenda includes external time even without website appointments`, () => {
    const calendar = loadServerModule<{ ScheduleCalendar: (props: Record<string, unknown>) => unknown }>(
      'src/components/admin/ScheduleCalendar.tsx', {
        react: { ...hooks, useEffect: () => undefined, useTransition: () => [false, () => undefined] },
        'next/navigation': { useRouter: () => ({ push: () => undefined, refresh: () => undefined }) },
        './ScheduleDayGrid': { ScheduleDayGrid: () => null },
        './ScheduleWeekGrid': { ScheduleWeekGrid: () => null },
        './AppointmentDialog': { AppointmentDialog: () => null },
        '@/app/actions/admin-schedule': {},
        '@/app/actions/admin': {},
      },
    );
    const rendered = calendar.ScheduleCalendar({
      dateStr: '2026-10-23', view, appointments: [], pendingAppointments: [],
      stylists: [{ id: 's1', name: 'Funky', calendarColor: null, availabilities: [] }],
      busyBlocks: [{ id: 'imported', stylistId: 's1', source: 'TREATWELL', start: '2026-10-23T13:00:00Z', end: '2026-10-23T14:00:00Z', lastSyncAt: '2026-09-20T00:00:00Z' }],
    });
    const mobile = elements(rendered).find(node => node.props.className === (view === 'day' ? 'sm:hidden' : 'md:hidden space-y-3'));
    assert.ok(mobile);
    function expand(node: unknown): Element[] {
      if (Array.isArray(node)) return node.flatMap(expand);
      if (!node || typeof node !== 'object' || !('props' in node)) return [];
      const element = node as Element;
      if (typeof element.type === 'function') return expand(element.type(element.props));
      return [element, ...expand(element.props.children)];
    }
    const notes = expand(mobile).filter(node => node.props.role === 'note');
    assert.equal(notes.length, 1);
    assert.match(String(notes[0].props['aria-label']), /Treatwell · Funky · 14:00–15:00/);
  });
}

for (const view of ['day', 'week', 'month']) {
  test(`${view} agenda opens the existing booking editor without changing the appointment`, () => {
    const updates: unknown[] = [];
    const calendar = loadServerModule<{ ScheduleCalendar: (props: Record<string, unknown>) => unknown }>(
      'src/components/admin/ScheduleCalendar.tsx', {
        react: { ...hooks, useState: (value: unknown) => [value, (next: unknown) => updates.push(next)], useEffect: () => undefined, useTransition: () => [false, () => undefined] },
        'next/navigation': { useRouter: () => ({ push: () => undefined, refresh: () => undefined }) },
        './ScheduleDayGrid': { ScheduleDayGrid: () => null },
        './ScheduleWeekGrid': { ScheduleWeekGrid: () => null },
        './AppointmentDialog': { AppointmentDialog: () => null },
        '@/app/actions/admin-schedule': {}, '@/app/actions/admin': {},
      },
    );
    const rendered = calendar.ScheduleCalendar({
      dateStr: '2026-10-23', view, pendingAppointments: [], busyBlocks: [],
      stylists: [{ id: 's1', name: 'Funky', calendarColor: null, availabilities: [] }],
      appointments: [{ id: 'owned-booking', date: '2026-10-23T10:30:00Z', updatedAt: '2026-09-20T18:00:00Z',
        status: 'CANCELLED', stylistId: 's1', serviceId: 'service1', durationAtBooking: 15, priceAtBooking: 0,
        notes: 'test note', user: { name: 'Test Customer' }, stylist: { name: 'Funky', calendarColor: null },
        service: { name: 'Consultation', duration: 30, price: 10, calendarColor: null } }],
    });
    function expand(node: unknown): Element[] {
      if (Array.isArray(node)) return node.flatMap(expand);
      if (!node || typeof node !== 'object' || !('props' in node)) return [];
      const element = node as Element;
      if (typeof element.type === 'function') return expand(element.type(element.props));
      return [element, ...expand(element.props.children)];
    }
    assert.ok(expand(rendered).some(node => node.props.children === 'CANCELLED'), 'cancelled bookings must be visibly identified');
    const edit = expand(rendered).find(node => node.type === 'button' && node.props.children === 'Edit booking');
    assert.ok(edit, 'agenda must expose an accessible edit action');
    (edit.props.onClick as () => void)();
    assert.deepEqual(updates.at(-1), { mode: 'edit', appointmentId: 'owned-booking', dateStr: '2026-10-23',
      time: '11:30', stylistId: 's1', serviceId: 'service1', durationMin: 15, notes: 'test note',
      customerName: 'Test Customer', status: 'CANCELLED', updatedAt: '2026-09-20T18:00:00Z' });
  });
}
