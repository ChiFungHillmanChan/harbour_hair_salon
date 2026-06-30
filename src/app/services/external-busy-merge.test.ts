import test from 'node:test';
import assert from 'node:assert/strict';
import { hasConflict } from './scheduling';
import { toBookedInterval } from './external-busy';

test('an external block makes an overlapping slot conflict', () => {
  const block = toBookedInterval({
    stylistId: 's1',
    start: new Date('2026-07-01T09:00:00Z'),
    end: new Date('2026-07-01T09:30:00Z'),
  });
  // booking 09:15–09:45 overlaps the 09:00–09:30 Treatwell block
  assert.equal(hasConflict(new Date('2026-07-01T09:15:00Z'), 30, [block]), true);
  // booking 09:30–10:00 is back-to-back → no conflict (half-open intervals)
  assert.equal(hasConflict(new Date('2026-07-01T09:30:00Z'), 30, [block]), false);
  // booking 08:00–08:30 well before the block → no conflict
  assert.equal(hasConflict(new Date('2026-07-01T08:00:00Z'), 30, [block]), false);
});
