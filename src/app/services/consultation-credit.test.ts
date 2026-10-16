import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSULTATION_CREDIT_MONTHS } from '../lib/booking-constants';
import {
  consultationCreditWindowStart,
  creditFor,
  findConsultationCredit,
  pickConsultationCredit,
  type ConsultationCreditCandidate,
} from './consultation-credit';

/** The treatment: Friday 16 October 2026, 14:00 in London (BST). */
const AT = new Date('2026-10-16T13:00:00Z');
/** "Now" for the pure rule: the morning the staff enter the treatment. */
const NOW = new Date('2026-10-16T08:00:00Z');

function consultation(overrides: Partial<ConsultationCreditCandidate> & { id: string; date: Date }): ConsultationCreditCandidate {
  return {
    status: 'COMPLETED',
    lateCancelledAt: null,
    priceAtBooking: '15.00',
    service: { isConsultation: true, isPatchTest: false },
    consultationCreditUsedBy: [],
    ...overrides,
  };
}

const pick = (rows: ConsultationCreditCandidate[], excludeAppointmentId?: string) =>
  pickConsultationCredit(rows, { at: AT, now: NOW, excludeAppointmentId });

const SEPT = new Date('2026-09-20T10:00:00Z');

test('the credit window is six months', () => {
  assert.equal(CONSULTATION_CREDIT_MONTHS, 6);
});

test('a COMPLETED consultation gives its price as credit', () => {
  assert.deepEqual(pick([consultation({ id: 'c1', date: SEPT })]), { fromAppointmentId: 'c1', amountPence: 1500, consultationDate: SEPT });
});

test('the patch-test consultation counts as a consultation too', () => {
  const row = consultation({ id: 'p1', date: SEPT, service: { isConsultation: false, isPatchTest: true } });
  assert.equal(pick([row])?.fromAppointmentId, 'p1');
});

test('a booking for any other service gives no credit', () => {
  assert.equal(pick([consultation({ id: 'x', date: SEPT, service: { isConsultation: false, isPatchTest: false } })]), null);
});

test('a CONFIRMED consultation whose start has passed gives credit', () => {
  assert.equal(pick([consultation({ id: 'c1', date: SEPT, status: 'CONFIRMED' })])?.fromAppointmentId, 'c1');
});

test('a CONFIRMED consultation that has not started yet gives none', () => {
  // Later today: before the treatment, but after "now".
  const later = new Date('2026-10-16T10:00:00Z');
  assert.equal(pick([consultation({ id: 'c1', date: later, status: 'CONFIRMED' })]), null);
});

test('a consultation the late-arrival rule cancelled gives none', () => {
  const lateCancelledAt = new Date('2026-09-20T10:15:00Z');
  assert.equal(pick([consultation({ id: 'c1', date: SEPT, status: 'CONFIRMED', lateCancelledAt })]), null);
});

test('CANCELLED and PENDING consultations give none', () => {
  assert.equal(pick([consultation({ id: 'c1', date: SEPT, status: 'CANCELLED' })]), null);
  assert.equal(pick([consultation({ id: 'c2', date: SEPT, status: 'PENDING' })]), null);
});

test('a consultation after the treatment starts gives none', () => {
  const after = new Date('2026-10-16T13:30:00Z');
  assert.equal(pickConsultationCredit([consultation({ id: 'c1', date: after })], { at: AT, now: new Date('2026-10-20T00:00:00Z') }), null);
});

test('six calendar months to the day still counts, whatever the time of day', () => {
  // 16 April 2026, 10:00 BST — earlier in the day than the 14:00 treatment.
  const exactly = new Date('2026-04-16T09:00:00Z');
  assert.equal(pick([consultation({ id: 'c1', date: exactly })])?.fromAppointmentId, 'c1');
});

test('six months and a day is too old', () => {
  // 15 April 2026, 23:30 BST.
  const tooOld = new Date('2026-04-15T22:30:00Z');
  assert.equal(pick([consultation({ id: 'c1', date: tooOld })]), null);
});

test('the window starts at salon-local midnight, six calendar months before the treatment day (BST and GMT)', () => {
  // BST treatment → 16 April 00:00 BST.
  assert.equal(consultationCreditWindowStart(AT).toISOString(), '2026-04-15T23:00:00.000Z');
  // GMT treatment → 16 June 00:00 BST.
  assert.equal(consultationCreditWindowStart(new Date('2026-12-16T14:00:00Z')).toISOString(), '2026-06-15T23:00:00.000Z');
  // BST treatment whose window opens in BST (16 October 2026) and one whose window opens in GMT (1 November).
  assert.equal(consultationCreditWindowStart(new Date('2027-04-16T13:00:00Z')).toISOString(), '2026-10-15T23:00:00.000Z');
  assert.equal(consultationCreditWindowStart(new Date('2027-05-01T13:00:00Z')).toISOString(), '2026-11-01T00:00:00.000Z');
  // 23:30 UTC on the 16th is already the 17th in London.
  assert.equal(consultationCreditWindowStart(new Date('2026-10-16T23:30:00Z')).toISOString(), '2026-04-16T23:00:00.000Z');
  // A month without the day clamps to its last day (31 August → 28 February).
  assert.equal(consultationCreditWindowStart(new Date('2026-08-31T12:00:00Z')).toISOString(), '2026-02-28T00:00:00.000Z');
});

test('a credit already used by a live treatment is not offered again', () => {
  for (const status of ['CONFIRMED', 'PENDING', 'COMPLETED']) {
    const row = consultation({ id: 'c1', date: SEPT, consultationCreditUsedBy: [{ id: 't1', status }] });
    assert.equal(pick([row]), null, status);
  }
});

test('a cancelled treatment gives its credit back', () => {
  const row = consultation({ id: 'c1', date: SEPT, consultationCreditUsedBy: [{ id: 't1', status: 'CANCELLED' }] });
  assert.equal(pick([row])?.fromAppointmentId, 'c1');
});

test('the treatment being edited still sees the credit it holds', () => {
  const row = consultation({ id: 'c1', date: SEPT, consultationCreditUsedBy: [{ id: 't1', status: 'CONFIRMED' }] });
  assert.equal(pick([row], 't1')?.fromAppointmentId, 'c1');
  // ...but not one another treatment holds.
  const shared = consultation({ id: 'c1', date: SEPT, consultationCreditUsedBy: [{ id: 't1', status: 'CONFIRMED' }, { id: 't2', status: 'CONFIRMED' }] });
  assert.equal(pick([shared], 't1'), null);
});

test('a free (or unpriced) consultation gives no credit', () => {
  assert.equal(pick([consultation({ id: 'c1', date: SEPT, priceAtBooking: '0.00' })]), null);
  assert.equal(pick([consultation({ id: 'c2', date: SEPT, priceAtBooking: null })]), null);
});

test('the amount is the consultation price in pence, read exactly', () => {
  assert.equal(pick([consultation({ id: 'c1', date: SEPT, priceAtBooking: '14.99' })])?.amountPence, 1499);
});

test('of two consultations the most recent qualifying one is offered', () => {
  const older = consultation({ id: 'old', date: new Date('2026-06-01T10:00:00Z') });
  const newer = consultation({ id: 'new', date: SEPT });
  assert.equal(pick([older, newer])?.fromAppointmentId, 'new');
  assert.equal(pick([newer, older])?.fromAppointmentId, 'new');
  // The most recent is used: the older one is offered instead.
  const newerUsed = { ...newer, consultationCreditUsedBy: [{ id: 't9', status: 'COMPLETED' }] };
  assert.equal(pick([newerUsed, older])?.fromAppointmentId, 'old');
});

test('creditFor caps the credit at the treatment price and is 0 without a credit', () => {
  const credit = { fromAppointmentId: 'c1', amountPence: 1500, consultationDate: SEPT };
  assert.equal(creditFor(credit, 4500), 1500);
  assert.equal(creditFor(credit, 1000), 1000);
  assert.equal(creditFor(credit, 0), 0);
  assert.equal(creditFor(null, 4500), 0);
});

test('findConsultationCredit reads this customer\'s consultations in the window, with who used them', async () => {
  const calls: unknown[] = [];
  const past = new Date(Date.now() - 7 * 24 * 3600_000);
  const at = new Date(Date.now() + 7 * 24 * 3600_000);
  const db = {
    appointment: {
      findMany: async (args: unknown) => {
        calls.push(args);
        return [consultation({ id: 'c1', date: past, status: 'CONFIRMED', priceAtBooking: '15' })];
      },
    },
  };
  const credit = await findConsultationCredit(db as never, { userId: 'u1', at });
  assert.deepEqual(credit, { fromAppointmentId: 'c1', amountPence: 1500, consultationDate: past });

  const args = calls[0] as { where: Record<string, unknown>; select: Record<string, unknown> };
  assert.equal(args.where.userId, 'u1');
  assert.deepEqual(args.where.service, { OR: [{ isConsultation: true }, { isPatchTest: true }] });
  assert.deepEqual(args.where.date, { gte: consultationCreditWindowStart(at), lte: at });
  assert.deepEqual(args.select.consultationCreditUsedBy, { select: { id: true, status: true } });
});

test('findConsultationCredit judges "has it happened" against the real clock', async () => {
  const soon = new Date(Date.now() + 3600_000);
  const at = new Date(Date.now() + 7 * 24 * 3600_000);
  const db = { appointment: { findMany: async () => [consultation({ id: 'c1', date: soon, status: 'CONFIRMED' })] } };
  assert.equal(await findConsultationCredit(db as never, { userId: 'u1', at }), null);
});

test('findConsultationCredit passes the booking being edited through', async () => {
  const past = new Date(Date.now() - 7 * 24 * 3600_000);
  const at = new Date(Date.now() + 7 * 24 * 3600_000);
  const db = {
    appointment: {
      findMany: async () => [consultation({ id: 'c1', date: past, consultationCreditUsedBy: [{ id: 't1', status: 'CONFIRMED' }] })],
    },
  };
  assert.equal(await findConsultationCredit(db as never, { userId: 'u1', at }), null);
  assert.equal((await findConsultationCredit(db as never, { userId: 'u1', at, excludeAppointmentId: 't1' }))?.fromAppointmentId, 'c1');
});
