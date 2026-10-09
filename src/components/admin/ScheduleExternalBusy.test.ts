import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Namespace } from '../../i18n/messages';

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
// The real i18n client hooks need a browser React; English text is asserted.
const i18nClient = { useT: (namespace: Namespace) => translator('en-GB', namespace), useLocale: () => 'en-GB' };
const draftStore = (useState: (value: unknown) => unknown) => ({
  useDraftState: (_key: string, initial: unknown) => useState(typeof initial === 'function' ? (initial as () => unknown)() : initial),
});
const navigation = { useLocalizedRouter: () => ({ push: () => undefined, refresh: () => undefined }) };
function render(view: 'Day' | 'Week', source: string, start: string, end: string, dayKey = '2026-10-23', duplicate = false) {
  const grid = loadServerModule<Record<string, (props: Record<string, unknown>) => unknown>>(
    `src/components/admin/Schedule${view}Grid.tsx`, { react: hooks, '@/i18n/client': i18nClient },
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
  test(`${view} calendar labels a whole-day Fresha block "Unavailable", keeping Fresha in the detail`, () => {
    // An all-day export on Tue 6 Oct 2026 (BST): London midnight to midnight.
    const nodes = render(view, 'FRESHA', '2026-10-05T23:00:00Z', '2026-10-06T23:00:00Z', '2026-10-06');
    assert.ok(nodes.some(node => node.props.children === 'Unavailable'), 'the block reads Unavailable');
    const note = nodes.find(node => node.props.role === 'note')!;
    assert.match(String(note.props['aria-label']), /Funky is unavailable/);
    assert.match(String(note.props['aria-label']), /Fresha/);
  });
  test(`${view} calendar keeps a short Fresha block labelled Fresha`, () => {
    const nodes = render(view, 'FRESHA', '2026-10-23T13:00:00Z', '2026-10-23T13:15:00Z');
    assert.ok(!nodes.some(node => node.props.children === 'Unavailable'));
    assert.ok(nodes.some(node => node.props.children === 'Fresha'));
  });
}

test('Day calendar: a 10:00–20:30 Pause for a stylist off in our rota is Unavailable against the salon’s hours', () => {
  const grid = loadServerModule<Record<string, (props: Record<string, unknown>) => unknown>>(
    'src/components/admin/ScheduleDayGrid.tsx', { react: hooks, '@/i18n/client': i18nClient },
  );
  const nodes = elements(grid.ScheduleDayGrid({
    day: new Date('2026-10-06T12:00:00Z'),
    stylists: [
      { id: 'funky', name: 'Funky', calendarColor: null, availability: null },
      { id: 'lox', name: 'Lox', calendarColor: null, availability: { startTime: '10:15', endTime: '19:00' } },
    ],
    appointments: [],
    busyBlocks: [{ id: 'pause', stylistId: 'funky', source: 'FRESHA', start: '2026-10-06T09:00:00Z', end: '2026-10-06T19:30:00Z', lastSyncAt: '2026-09-20T00:00:00Z' }],
  }));
  const note = nodes.find(node => node.props.role === 'note')!;
  assert.match(String(note.props['aria-label']), /Funky is unavailable · 10:00–20:30/);
});

test('Week calendar: a Pause covering the stylist’s own hours is Unavailable; a lunch block is not', () => {
  const grid = loadServerModule<Record<string, (props: Record<string, unknown>) => unknown>>(
    'src/components/admin/ScheduleWeekGrid.tsx', { react: hooks, '@/i18n/client': i18nClient },
  );
  const nodes = elements(grid.ScheduleWeekGrid({
    day: new Date('2026-10-06T12:00:00Z'), dayKeys: ['2026-10-06'], todayKey: '2026-10-06',
    stylists: [{ id: 'ivan', name: 'Ivan', calendarColor: null, availability: null, availabilityByWeekday: { 2: { startTime: '10:00', endTime: '19:30' } } }],
    appointments: [],
    busyBlocks: [
      { id: 'pause', stylistId: 'ivan', source: 'FRESHA', start: '2026-10-06T09:00:00Z', end: '2026-10-06T19:30:00Z', lastSyncAt: '2026-09-20T00:00:00Z' },
      { id: 'lunch', stylistId: 'ivan', source: 'FRESHA', start: '2026-10-06T12:00:00Z', end: '2026-10-06T13:00:00Z', lastSyncAt: '2026-09-20T00:00:00Z' },
    ],
  }));
  const labels = nodes.filter(node => node.props.role === 'note').map(node => String(node.props['aria-label']));
  assert.ok(labels.some(label => /Ivan is unavailable · 10:00–20:30/.test(label)));
  assert.ok(labels.some(label => /^Fresha · Ivan · 13:00–14:00/.test(label)));
});

for (const view of ['day', 'week']) {
  test(`mobile ${view} agenda includes external time even without website appointments`, () => {
    const calendar = loadServerModule<{ ScheduleCalendar: (props: Record<string, unknown>) => unknown }>(
      'src/components/admin/ScheduleCalendar.tsx', {
        react: { ...hooks, useEffect: () => undefined, useTransition: () => [false, () => undefined] },
        '@/i18n/navigation': navigation,
        '@/i18n/client': i18nClient,
        '@/i18n/draft-store': draftStore(hooks.useState),
        './ScheduleDayGrid': { ScheduleDayGrid: () => null },
        './ScheduleWeekGrid': { ScheduleWeekGrid: () => null },
        './AppointmentDialog': { AppointmentDialog: () => null },
        './RescheduleRequestActions': { RescheduleRequestActions: () => null },
        '@/app/actions/admin-schedule': {},
        '@/app/actions/admin': {},
      },
    );
    const rendered = calendar.ScheduleCalendar({
      dateStr: '2026-10-23', view, appointments: [], pendingAppointments: [], rescheduleRequests: [],
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

test('mobile day agenda says a stylist on a whole-day Fresha block is unavailable all day', () => {
  const calendar = loadServerModule<{ ScheduleCalendar: (props: Record<string, unknown>) => unknown }>(
    'src/components/admin/ScheduleCalendar.tsx', {
      react: { ...hooks, useEffect: () => undefined, useTransition: () => [false, () => undefined] },
      '@/i18n/navigation': navigation,
      '@/i18n/client': i18nClient,
      '@/i18n/draft-store': draftStore(hooks.useState),
      './ScheduleDayGrid': { ScheduleDayGrid: () => null },
      './ScheduleWeekGrid': { ScheduleWeekGrid: () => null },
      './AppointmentDialog': { AppointmentDialog: () => null },
      './RescheduleRequestActions': { RescheduleRequestActions: () => null },
      '@/app/actions/admin-schedule': {}, '@/app/actions/admin': {},
    },
  );
  const rendered = calendar.ScheduleCalendar({
    dateStr: '2026-10-06', view: 'day', appointments: [], pendingAppointments: [], rescheduleRequests: [],
    stylists: [{ id: 's1', name: 'Funky', calendarColor: null, availabilities: [{ dayOfWeek: 2, startTime: '10:15', endTime: '19:00', isOff: false }] }],
    busyBlocks: [{ id: 'pause', stylistId: 's1', source: 'FRESHA', start: '2026-10-06T09:00:00Z', end: '2026-10-06T19:30:00Z', lastSyncAt: '2026-09-20T00:00:00Z' }],
  });
  function expand(node: unknown): Element[] {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as Element;
    if (typeof element.type === 'function') return expand(element.type(element.props));
    return [element, ...expand(element.props.children)];
  }
  const mobile = elements(rendered).find(node => node.props.className === 'sm:hidden');
  assert.ok(mobile);
  const texts = expand(mobile).flatMap((node) => [node.props.children].flat().filter((child) => typeof child === 'string'));
  assert.ok(texts.includes('Funky · Unavailable all day'));
  assert.ok(texts.includes('Unavailable'));
});

for (const view of ['day', 'week', 'month']) {
  test(`${view} agenda opens the existing booking editor without changing the appointment`, () => {
    const updates: unknown[] = [];
    const useState = (value: unknown) => [value, (next: unknown) => updates.push(next)];
    const calendar = loadServerModule<{ ScheduleCalendar: (props: Record<string, unknown>) => unknown }>(
      'src/components/admin/ScheduleCalendar.tsx', {
        react: { ...hooks, useState, useEffect: () => undefined, useTransition: () => [false, () => undefined] },
        '@/i18n/navigation': navigation,
        '@/i18n/client': i18nClient,
        '@/i18n/draft-store': draftStore(useState),
        './ScheduleDayGrid': { ScheduleDayGrid: () => null },
        './ScheduleWeekGrid': { ScheduleWeekGrid: () => null },
        './AppointmentDialog': { AppointmentDialog: () => null },
        './RescheduleRequestActions': { RescheduleRequestActions: () => null },
        '@/app/actions/admin-schedule': {}, '@/app/actions/admin': {},
      },
    );
    const rendered = calendar.ScheduleCalendar({
      dateStr: '2026-10-23', view, pendingAppointments: [], rescheduleRequests: [], busyBlocks: [],
      stylists: [{ id: 's1', name: 'Funky', calendarColor: null, availabilities: [] }],
      appointments: [{ id: 'owned-booking', date: '2026-10-23T10:30:00Z', updatedAt: '2026-09-20T18:00:00Z',
        status: 'CANCELLED', stylistId: 's1', serviceId: 'service1', durationAtBooking: 15,
        price: { known: true, amountPence: 0, priceType: null, vatDisplay: null, priceNature: null },
        notes: 'test note', rescheduleRequestedDate: null, rescheduleRequestedAt: null, user: { name: 'Test Customer' }, stylist: { name: 'Funky', calendarColor: null },
        service: { name: 'Consultation', duration: 30, calendarColor: null } }],
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
      customerName: 'Test Customer', status: 'CANCELLED', updatedAt: '2026-09-20T18:00:00Z',
      price: { known: true, amountPence: 0, priceType: null, vatDisplay: null, priceNature: null },
      date: '2026-10-23T10:30:00Z', rescheduleRequestedDate: null, rescheduleRequestedAt: null });
  });
}

test('an appointment whose price was never recorded says so instead of showing today\'s service price', () => {
  const calendar = loadServerModule<{ ScheduleCalendar: (props: Record<string, unknown>) => unknown }>(
    'src/components/admin/ScheduleCalendar.tsx', {
      react: { ...hooks, useEffect: () => undefined, useTransition: () => [false, () => undefined] },
      '@/i18n/navigation': navigation,
      '@/i18n/client': i18nClient,
      '@/i18n/draft-store': draftStore(hooks.useState),
      './ScheduleDayGrid': { ScheduleDayGrid: () => null },
      './ScheduleWeekGrid': { ScheduleWeekGrid: () => null },
      './AppointmentDialog': { AppointmentDialog: () => null },
      './RescheduleRequestActions': { RescheduleRequestActions: () => null },
      '@/app/actions/admin-schedule': {}, '@/app/actions/admin': {},
    },
  );
  const appointment = (id: string, price: Record<string, unknown>) => ({
    id, date: '2026-10-23T10:30:00Z', updatedAt: '2026-09-20T18:00:00Z', status: 'CONFIRMED', stylistId: 's1',
    serviceId: 'service1', durationAtBooking: 45, price, notes: null, user: { name: `Customer ${id}` },
    stylist: { name: 'Funky', calendarColor: null }, service: { name: 'Blow Dry', duration: 45, calendarColor: null },
  });
  const rendered = calendar.ScheduleCalendar({
    dateStr: '2026-10-23', view: 'day', pendingAppointments: [], rescheduleRequests: [], busyBlocks: [],
    stylists: [{ id: 's1', name: 'Funky', calendarColor: null, availabilities: [] }],
    appointments: [
      appointment('legacy', { known: false }),
      appointment('quoted', { known: true, amountPence: 14200, priceType: 'NHS', vatDisplay: 'EXCLUDED', priceNature: 'SUBJECT_TO_CONSULTATION' }),
    ],
  });
  function expand(node: unknown): Element[] {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as Element;
    if (typeof element.type === 'function') return expand(element.type(element.props));
    return [element, ...expand(element.props.children)];
  }
  const texts = expand(rendered).flatMap((node) => [node.props.children].flat().filter((child) => typeof child === 'string'));
  assert.ok(texts.includes('Price not recorded'), 'an unknown amount is shown as unknown');
  assert.ok(texts.includes('£142.00'), 'a recorded amount is shown as recorded');
  assert.ok(texts.some((text) => /NHS price applied · VAT excluded · May be adjusted after consultation/.test(text)));
  assert.ok(!texts.some((text) => /£0\.00/.test(text)), 'an unknown amount is never shown as zero');
});

test('a reschedule request row shows when it was asked and a tel: link for the customer', () => {
  const calendar = loadServerModule<{ ScheduleCalendar: (props: Record<string, unknown>) => unknown }>(
    'src/components/admin/ScheduleCalendar.tsx', {
      react: { ...hooks, useEffect: () => undefined, useTransition: () => [false, () => undefined] },
      '@/i18n/navigation': navigation,
      '@/i18n/client': i18nClient,
      '@/i18n/draft-store': draftStore(hooks.useState),
      './ScheduleDayGrid': { ScheduleDayGrid: () => null },
      './ScheduleWeekGrid': { ScheduleWeekGrid: () => null },
      './AppointmentDialog': { AppointmentDialog: () => null },
      './RescheduleRequestActions': { RescheduleRequestActions: () => null },
      '@/app/actions/admin-schedule': {}, '@/app/actions/admin': {},
    },
  );
  const rendered = calendar.ScheduleCalendar({
    dateStr: '2026-10-23', view: 'day', pendingAppointments: [], busyBlocks: [], appointments: [],
    stylists: [{ id: 's1', name: 'Funky', calendarColor: null, availabilities: [] }],
    rescheduleRequests: [{ id: 'r1', date: '2026-10-30T10:00:00Z', requestedDate: '2026-11-02T10:00:00Z', requestedAt: '2026-10-20T09:30:00Z', expired: false,
      user: { name: 'Ben', phone: '07000 000000' }, stylist: { name: 'Lox' }, service: { name: 'Colour' } }],
  });
  function expand(node: unknown): Element[] {
    if (Array.isArray(node)) return node.flatMap(expand);
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as Element;
    if (typeof element.type === 'function') return expand(element.type(element.props));
    return [element, ...expand(element.props.children)];
  }
  const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('')
    : typeof node === 'string' || typeof node === 'number' ? String(node)
    : node && typeof node === 'object' && 'props' in node ? text((node as Element).props.children) : '';
  const all = expand(rendered);
  assert.match(text(rendered), /asked .*20 October.*10:30/i, 'the absolute ask time is shown');
  const tel = all.find((node) => node.type === 'a' && node.props.href === 'tel:07000 000000');
  assert.ok(tel, 'the customer phone is a tel: link');
});
