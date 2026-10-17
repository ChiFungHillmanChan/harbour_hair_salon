import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadServerModule } from '../../test/load-server-module';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

// A red walk-in (UNASSIGNED) 15:00–16:00 on Tuesday 2026-10-06 (spec §6).
const DAY = '2026-10-06';
const at = (time: string) => resolveSalonDateTime(DAY, time).utc;
type Where = Record<string, unknown>;
const idsOf = (value: unknown) => (typeof value === 'string' ? [value] : (value as { in: string[] }).in);

function fixture(input: { funkyBusyAt?: string; funkyUntil?: string; ivan?: boolean; shania?: boolean } = {}) {
  const hours = [
    { stylistId: 'lox', dayOfWeek: 2, startTime: '10:00', endTime: '19:00' },
    { stylistId: 'funky', dayOfWeek: 2, startTime: '10:00', endTime: input.funkyUntil ?? '19:00' },
    ...(input.ivan ? [{ stylistId: 'ivan', dayOfWeek: 2, startTime: '10:00', endTime: '19:00' }] : []),
    // An assistant on the rota who takes no walk-ins (Stylist.takesWalkIns false).
    ...(input.shania ? [{ stylistId: 'shania', dayOfWeek: 2, startTime: '10:00', endTime: '19:00' }] : []),
  ];
  const takesWalkIns = (stylistId: string) => stylistId !== 'shania';
  const appointments = input.funkyBusyAt
    ? [{ id: 'f1', stylistId: 'funky', date: at(input.funkyBusyAt), durationAtBooking: 60, service: { duration: 60 } }]
    : [];
  const walkIn = { start: at('15:00'), end: at('16:00') };
  const db = {
    availability: {
      findMany: async ({ where }: { where: Where & { stylist?: { takesWalkIns?: boolean } } }) => hours.filter((row) =>
        (!where.stylistId || row.stylistId === where.stylistId)
        && (where.stylist?.takesWalkIns === undefined || takesWalkIns(row.stylistId) === where.stylist.takesWalkIns)),
      findFirst: async ({ where }: { where: Where }) => hours.find((row) => row.stylistId === where.stylistId && row.dayOfWeek === where.dayOfWeek) ?? null,
    },
    appointment: {
      findMany: async ({ where }: { where: Where }) => appointments.filter((row) => idsOf(where.stylistId).includes(row.stylistId)),
      count: async () => 0,
    },
    externalBusyBlock: { findMany: async () => [] },
    googleDiaryEntry: {
      findMany: async ({ where }: { where: { kind: string; start: { lt: Date }; end: { gt: Date } } }) =>
        [walkIn].filter((row) => where.kind === 'UNASSIGNED' && row.start < where.start.lt && row.end > where.end.gt),
    },
  };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({}) },
    './notification-outbox-service': {},
    './pricing/quote-service': { quoteForNewBooking: async () => ({ service: { id: 'svc', duration: 60, treatwellExternalId: null }, quote: { amountPence: 3000 } }) },
  });
  return { service, db };
}
const slot = (days: { slots: { time: string; available: boolean }[] }[], time: string) => days[0].slots.find((s) => s.time === time)?.available;

test('Lox’s times meeting the walk-in are taken when nobody else could serve it (Funky booked)', async () => {
  const { service } = fixture({ funkyBusyAt: '15:00' });
  const days = await service.getBookingDays('lox', [DAY], 60);
  for (const time of ['14:30', '15:00', '15:30']) assert.equal(slot(days, time), false, time);
  for (const time of ['14:00', '16:00']) assert.equal(slot(days, time), true, time);
  assert.ok(!(await service.getAvailableSlots('lox', DAY, 60)).some((s) => s.time === '15:00'));
});

test('with Funky free, Lox keeps 15:00: Funky serves the walk-in', async () => {
  const { service } = fixture();
  assert.equal(slot(await service.getBookingDays('lox', [DAY], 60), '15:00'), true);
  assert.ok((await service.getAvailableSlots('lox', DAY, 60)).some((s) => s.time === '15:00'));
});

test('Funky rostered only until 15:30 does not count: the walk-in must be covered whole', async () => {
  assert.equal(slot(await fixture({ funkyUntil: '15:30' }).service.getBookingDays('lox', [DAY], 60), '15:00'), false);
});

test('"Anyone" stays open while one stylist can take the booking and another the walk-in, and closes when not', async () => {
  assert.equal(slot(await fixture().service.getBookingDays(ANY_STYLIST_ID, [DAY], 60), '15:00'), true);
  assert.equal(slot(await fixture({ funkyBusyAt: '15:00' }).service.getBookingDays(ANY_STYLIST_ID, [DAY], 60), '15:00'), false);
  assert.ok(!(await fixture({ funkyBusyAt: '15:00' }).service.getAvailableSlotsUnion(DAY, 60)).some((s) => s.time === '15:00'));
});

test('a submitted request is refused with the slot-unavailable error; { chairRule: false } (staff) is not', async () => {
  const { service, db } = fixture({ funkyBusyAt: '15:00' });
  const appointment = { id: '', stylistId: 'lox', durationAtBooking: 60, service: { duration: 60 } };
  await assert.rejects(service.assertAppointmentSlotAvailable(db as never, appointment, at('15:00')), (error: { code?: string }) => error.code === 'SLOT_UNAVAILABLE');
  await service.assertAppointmentSlotAvailable(db as never, appointment, at('15:00'), undefined, { chairRule: false });
});

test('"Anyone": NO_STYLIST_AT_TIME when no candidate leaves a chair; a free stylist outside the candidates still serves the walk-in', async () => {
  const request = { userId: 'u1', serviceId: 'svc', date: at('15:00'), candidateStylistIds: ['lox', 'funky'] };
  await assert.rejects(fixture({ funkyBusyAt: '15:00' }).service.precheckBookingRequest(request), (error: { code?: string }) => error.code === 'NO_STYLIST_AT_TIME');
  // Ivan does not offer this service (not a candidate) but is free at 15:00.
  await fixture({ funkyBusyAt: '15:00', ivan: true }).service.precheckBookingRequest(request);
});

test('staff paths in actions/admin.ts never apply the chair rule (confirming a request, approving a move)', () => {
  const source = readFileSync('src/app/actions/admin.ts', 'utf8');
  const calls = source.match(/assertAppointmentSlotAvailable\(/g) ?? [];
  const exempt = source.match(/assertAppointmentSlotAvailable\([^;]*\{ chairRule: false \}\)/g) ?? [];
  assert.equal(calls.length, 4);
  assert.equal(exempt.length, calls.length);
});

/** The source of one top-level function, from its declaration to its closing brace. */
function functionSource(source: string, name: string): string {
  const start = source.search(new RegExp(`^(export )?async function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}\n', start));
}

// The mirror of the staff-path pin: the customer paths always apply the chair rule.
test('customer paths never skip the chair rule: createBooking, precheckBookingRequest and requestReschedule', () => {
  const service = readFileSync('src/app/services/booking-service.ts', 'utf8');
  const actions = readFileSync('src/app/actions/booking.ts', 'utf8');
  for (const [name, source] of [['createBooking', service], ['requestReschedule', actions]] as const) {
    const body = functionSource(source, name);
    assert.equal(body.match(/assertAppointmentSlotAvailable\(/g)?.length, 1, name);
    assert.doesNotMatch(body, /chairRule/, name);
  }
  // "Anyone" (the pre-check and the booking): chooseFreeStylist applies the rule to every candidate,
  // so the slot re-check for the stylist it chose is the only call allowed to pass { chairRule: false }.
  assert.match(functionSource(service, 'chooseFreeStylist'), /diaryChairAllows\(/);
  const afterChoosing = /const \{ stylistId, blocking \} = await chooseFreeStylist\([^;]*\);\s*(\/\/[^\n]*\s*)?await assertAppointmentSlotAvailable\([^;]*\{ chairRule: false \}\);/;
  const precheck = functionSource(service, 'precheckBookingRequest');
  const calls = precheck.match(/assertAppointmentSlotAvailable\([^;]*\);/g) ?? [];
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((call) => call.includes('chairRule')).length, 1, 'only the "Anyone" re-check');
  assert.doesNotMatch(calls[1], /chairRule/, 'a named stylist');
  assert.match(precheck, afterChoosing);
  const anyone = functionSource(service, 'createBookingForFirstAvailable');
  assert.equal(anyone.match(/assertAppointmentSlotAvailable\(/g)?.length, 1);
  assert.match(anyone, /const \{ stylistId, blocking \} = await chooseFreeStylist\(/);
  assert.match(anyone, /\{ chairRule: false \}\);/);
});

test('a rostered assistant who takes no walk-ins never covers one, and stays bookable over it herself', async () => {
  // Shania is free all afternoon, but only Lox and Funky take walk-ins: with Funky booked, Lox's 15:00 stays taken.
  const { service } = fixture({ funkyBusyAt: '15:00', shania: true });
  assert.equal(slot(await service.getBookingDays('lox', [DAY], 60), '15:00'), false);
  // Her own booking uses no walk-in chair.
  assert.equal(slot(await service.getBookingDays('shania', [DAY], 60), '15:00'), true);
});
