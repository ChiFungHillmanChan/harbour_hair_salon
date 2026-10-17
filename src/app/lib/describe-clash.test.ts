import test from 'node:test';
import assert from 'node:assert/strict';
import { translator } from '../../i18n/messages';
import { describeClash } from './describe-clash';

const start = new Date('2026-10-23T14:00:00Z'); // 15:00 in London (BST)
const end = new Date('2026-10-23T15:00:00Z');

test('the chair warning names the Google diary, the numbers and the London time, in both languages', () => {
  const clash = { kind: 'DIARY_CHAIR' as const, needed: 2, free: 1, start, end };
  assert.equal(describeClash(clash, translator('en-GB', 'adminSchedule')),
    'Leaves too few stylists for the Google diary’s bookings without a stylist at 15:00–16:00 (2 needed, 1 free)');
  assert.equal(describeClash(clash, translator('zh-HK', 'adminSchedule')),
    '15:00–16:00 Google 日曆中未指定髮型師的預約將沒有足夠空閒髮型師（需要 2 位，空閒 1 位）');
});
