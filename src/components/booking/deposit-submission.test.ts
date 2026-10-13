import test from 'node:test';
import assert from 'node:assert/strict';
import { afterDepositAnswer, keepSubmissionAfter, MAX_PENDING_ANSWERS, PAYMENT_ANSWER_CODES, reusableSubmission, submissionFingerprint } from './deposit-submission';

const REQUEST = { serviceId: 'service-1', stylistId: 'any', date: '2026-10-06', time: '11:00', depositPence: 2000 };
const SUBMISSION = { attemptKey: '3b241101-e2bb-4255-8caf-4136c566a962', token: 'cnon:ok', fingerprint: submissionFingerprint(REQUEST), pendingAnswers: 0 };

test('a token made for one request is never sent for another', () => {
  const fingerprint = submissionFingerprint(REQUEST);
  const pending = SUBMISSION;
  assert.equal(reusableSubmission(pending, submissionFingerprint({ ...REQUEST })), pending, 'the same request: retry it as it was');
  assert.equal(reusableSubmission(null, fingerprint), null);
  for (const change of [{ serviceId: 'service-2' }, { stylistId: 'lox' }, { date: '2026-10-07' }, { time: '11:15' }, { depositPence: 2500 }]) {
    assert.equal(reusableSubmission(pending, submissionFingerprint({ ...REQUEST, ...change })), null, JSON.stringify(change));
  }
});

test('only an answer still being settled keeps the same key and token', () => {
  assert.equal(keepSubmissionAfter({ success: false, code: 'PAYMENT_PENDING' }), true);
  for (const answer of [
    { success: true }, { success: false, code: 'CARD_DECLINED' }, { success: false, code: 'PAYMENT_UNCERTAIN' },
    { success: false, code: 'QUOTE_CHANGED' }, { success: false, code: 'SLOT_UNAVAILABLE' }, { success: false },
  ]) {
    assert.equal(keepSubmissionAfter(answer), false, JSON.stringify(answer));
  }
});

test('a submission still pending after two tries in a row is dropped: the next card entry starts afresh', () => {
  assert.equal(MAX_PENDING_ANSWERS, 2);
  const pending = { success: false, code: 'PAYMENT_PENDING' };
  const first = afterDepositAnswer(SUBMISSION, pending);
  assert.deepEqual(first, { keep: { ...SUBMISSION, pendingAnswers: 1 }, stuck: false }, 'the first pending answer: send the same key and token again');
  assert.equal(first.keep?.attemptKey, SUBMISSION.attemptKey);
  assert.deepEqual(afterDepositAnswer(first.keep!, pending), { keep: null, stuck: true }, 'the second in a row: give up on it');
  // Any other answer settles it, whatever came before — and is not "stuck".
  for (const answer of [{ success: true }, { success: false, code: 'PAYMENT_UNCERTAIN' }, { success: false, code: 'CARD_DECLINED' }]) {
    assert.deepEqual(afterDepositAnswer(first.keep!, answer), { keep: null, stuck: false }, JSON.stringify(answer));
  }
});

test('answers about the card do not send the customer back to re-read the diary', () => {
  for (const code of ['PAYMENT_REQUIRED', 'PAYMENT_UNAVAILABLE', 'CARD_DECLINED', 'PAYMENT_UNCERTAIN', 'PAYMENT_PENDING', 'QUOTE_CHANGED']) {
    assert.ok(PAYMENT_ANSWER_CODES.has(code), code);
  }
  for (const code of ['SLOT_UNAVAILABLE', 'NO_STYLIST_AT_TIME', 'BOOKING_FAILED']) assert.equal(PAYMENT_ANSWER_CODES.has(code), false, code);
});
