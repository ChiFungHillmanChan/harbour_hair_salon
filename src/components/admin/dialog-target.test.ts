import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withLiveDeposit } from './dialog-target';
import type { DialogTarget } from './AppointmentDialog';

// Sandbox acceptance, 15 October 2026: after "Mark refund as settled outside the
// website" the board refreshed, but the open booking dialog still showed the
// pending refund and its settle button until closed and reopened — it kept the
// row it was opened with.

const PENDING_REFUND = { state: 'REFUND_PENDING', amountPence: 740, refundToSettle: { id: 'refund-1', amountPence: 740 } } as const;
const REFUNDED = { state: 'REFUNDED', amountPence: 740 } as const;
const OPENED: DialogTarget = {
  mode: 'edit', appointmentId: 'appt-1', dateStr: '2026-10-16', time: '10:15', stylistId: 'lox', serviceId: 'cut', durationMin: 55,
  notes: '', customerName: 'Ada', status: 'CANCELLED', updatedAt: '2026-10-15T00:30:00.000Z',
  price: { amountPence: 3700 } as never, date: '2026-10-16T09:15:00.000Z', rescheduleRequestedDate: null, rescheduleRequestedAt: null,
  deposit: PENDING_REFUND as never,
};

test('an open dialog follows the deposit the refreshed board now shows', () => {
  const live = withLiveDeposit(OPENED, new Map([['appt-1', { deposit: REFUNDED as never }]]));
  assert.deepEqual(live.mode === 'edit' && live.deposit, REFUNDED, 'refunded, and no settle button (refundToSettle) any more');
});

test('only the deposit moves: updatedAt stays the one the dialog opened with, so a save still sees a change made meanwhile', () => {
  const live = withLiveDeposit(OPENED, new Map([['appt-1', { deposit: REFUNDED as never, updatedAt: '2026-10-15T00:31:00.000Z', status: 'CONFIRMED' }]]));
  assert.deepEqual({ ...live, deposit: undefined }, { ...OPENED, deposit: undefined });
});

test('a booking no longer on the board, and a new booking, are left as they are', () => {
  assert.equal(withLiveDeposit(OPENED, new Map()), OPENED);
  const blank: DialogTarget = { mode: 'create', dateStr: '2026-10-16', time: '10:00' };
  assert.equal(withLiveDeposit(blank, new Map([['appt-1', { deposit: REFUNDED as never }]])), blank);
});
