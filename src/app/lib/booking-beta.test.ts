import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKING_BETA_MAX_TESTERS, bookingBetaEmailsSchema, isBookingBetaTester, parseBookingBetaEmails } from './booking-beta';
import { placeholderEmailFor } from './walk-in-customer';

test('the list splits on commas, semicolons, spaces and line breaks; trims, lowercases, dedupes and keeps order', () => {
  assert.deepEqual(parseBookingBetaEmails(''), []);
  assert.deepEqual(parseBookingBetaEmails('  \n ,; '), []);
  assert.deepEqual(
    parseBookingBetaEmails(' Ada@Example.com,bob@example.com;\n carol@example.com\r\n\tdan@example.com  ada@example.com\nBOB@EXAMPLE.COM '),
    ['ada@example.com', 'bob@example.com', 'carol@example.com', 'dan@example.com'],
  );
  assert.deepEqual(parseBookingBetaEmails('hillmanchan709@gmail.com'), ['hillmanchan709@gmail.com']);
  // Not a string (a row read wrongly): no testers rather than a crash.
  assert.deepEqual(parseBookingBetaEmails(undefined as unknown as string), []);
});

test('a tester is an exact match once both sides are lowercase', () => {
  const list = 'hillmanchan709@gmail.com, tester@example.com';
  assert.equal(isBookingBetaTester('hillmanchan709@gmail.com', list), true);
  assert.equal(isBookingBetaTester('HillmanChan709@Gmail.com', list), true);
  assert.equal(isBookingBetaTester('hillmanchan709@gmail.co', list), false);
  assert.equal(isBookingBetaTester('xhillmanchan709@gmail.com', list), false);
  assert.equal(isBookingBetaTester('gmail.com', list), false);
  assert.equal(isBookingBetaTester('', list), false);
  assert.equal(isBookingBetaTester(null, list), false);
  assert.equal(isBookingBetaTester(undefined, list), false);
  assert.equal(isBookingBetaTester('tester@example.com', ''), false);
});

test('a walk-in or erased placeholder never counts as a tester, even if it was stored', () => {
  const walkIn = placeholderEmailFor('mrs-wong');
  assert.equal(isBookingBetaTester(walkIn, walkIn), false);
  assert.equal(isBookingBetaTester('x@erased.invalid', 'x@erased.invalid'), false);
});

test('the settings box stores the list normalised, ", "-joined; blank clears it', () => {
  assert.deepEqual(bookingBetaEmailsSchema.safeParse(' HillmanChan709@gmail.com\nTester@Example.com;tester@example.com ').data,
    'hillmanchan709@gmail.com, tester@example.com');
  assert.equal(bookingBetaEmailsSchema.safeParse('').data, '');
  assert.equal(bookingBetaEmailsSchema.safeParse(' \n ').data, '');
});

function refusal(raw: string) {
  const parsed = bookingBetaEmailsSchema.safeParse(raw);
  assert.equal(parsed.success, false, raw.slice(0, 40));
  const issue = parsed.error!.issues[0];
  return { message: issue.message, params: issue.code === 'custom' ? issue.params : undefined };
}

test('the settings box refuses an invalid address, naming it', () => {
  assert.deepEqual(refusal('good@example.com\nnot-an-email'), { message: 'BETA_EMAIL', params: { email: 'not-an-email' } });
  assert.deepEqual(refusal('a@b@example.com'), { message: 'BETA_EMAIL', params: { email: 'a@b@example.com' } });
  assert.deepEqual(refusal(`${'x'.repeat(250)}@example.com`).message, 'BETA_EMAIL');
});

test('the settings box refuses walk-in and erased placeholders', () => {
  const walkIn = placeholderEmailFor('mrs-wong');
  assert.deepEqual(refusal(walkIn), { message: 'BETA_PLACEHOLDER', params: { email: walkIn } });
  assert.deepEqual(refusal('someone@erased.invalid'), { message: 'BETA_PLACEHOLDER', params: { email: 'someone@erased.invalid' } });
});

test(`the settings box takes at most ${BOOKING_BETA_MAX_TESTERS} addresses, and bounds the text it splits`, () => {
  const addresses = (count: number) => Array.from({ length: count }, (_, i) => `tester${i}@example.com`).join('\n');
  assert.equal(bookingBetaEmailsSchema.safeParse(addresses(BOOKING_BETA_MAX_TESTERS)).success, true);
  assert.deepEqual(refusal(addresses(BOOKING_BETA_MAX_TESTERS + 1)), { message: 'BETA_TOO_MANY', params: { max: BOOKING_BETA_MAX_TESTERS } });
  // Repeats count once.
  assert.equal(bookingBetaEmailsSchema.safeParse(`${addresses(BOOKING_BETA_MAX_TESTERS)}\ntester0@example.com`).success, true);
  assert.equal(refusal(' '.repeat(10_001)).message, 'TOO_LONG');
});
