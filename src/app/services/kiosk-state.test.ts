import test from 'node:test';
import assert from 'node:assert/strict';
import { nextClockAction } from './kiosk-state';

test('no open entry -> CLOCK_IN', () => {
  assert.deepEqual(nextClockAction(null), { type: 'CLOCK_IN' });
});

test('open entry -> CLOCK_OUT with that entry id', () => {
  assert.deepEqual(nextClockAction({ id: 'te_1' }), { type: 'CLOCK_OUT', entryId: 'te_1' });
});
