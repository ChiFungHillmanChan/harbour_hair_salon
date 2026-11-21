import test from 'node:test';
import assert from 'node:assert/strict';
import { cspViolationReport, scrubCardCheckText, thrownReport, tokenizeRefusalReport } from './card-check-report';

test('free text is scrubbed: digit runs masked, control characters gone, length capped', () => {
  assert.equal(scrubCardCheckText('card 4111-1111-1111-1111 exp 12/29 cvv 123'), 'card # exp 12/29 cvv 123');
  assert.equal(scrubCardCheckText('call 07700 900123\nnow'), 'call # now');
  assert.equal(scrubCardCheckText('x'.repeat(500))?.length, 200);
  assert.equal(scrubCardCheckText('   '), undefined);
  assert.equal(scrubCardCheckText(42), undefined);
});

test('a refusal keeps Square’s categories, deduplicated, and survives odd shapes', () => {
  assert.deepEqual(tokenizeRefusalReport({ status: 'Cancel' }), { kind: 'TOKENIZE_REFUSED', status: 'Cancel', errorTypes: undefined, fields: undefined, detail: undefined });
  assert.deepEqual(tokenizeRefusalReport({ errors: 'nonsense' }).status, 'none');
  const report = tokenizeRefusalReport({ status: 'Error', errors: [{ type: 'UNEXPECTED_ERROR' }, { type: 'UNEXPECTED_ERROR', field: 7 }, null] });
  assert.deepEqual([report.errorTypes, report.fields], ['UNEXPECTED_ERROR', undefined]);
});

test('a thrown value becomes its class and message', () => {
  assert.deepEqual(thrownReport('SUBMIT_FAILED', new TypeError('Failed to fetch')), { kind: 'SUBMIT_FAILED', errorKind: 'TypeError', detail: 'Failed to fetch' });
  assert.deepEqual(thrownReport('TOKENIZE_THREW', 'plain string'), { kind: 'TOKENIZE_THREW', errorKind: 'string', detail: 'plain string' });
  assert.deepEqual(thrownReport('CARD_FORM_FAILED', undefined), { kind: 'CARD_FORM_FAILED', errorKind: 'undefined', detail: undefined });
});

test('a CSP violation keeps the origin only — never a bank page’s path or query', () => {
  assert.deepEqual(cspViolationReport({ effectiveDirective: 'frame-src', blockedURI: 'https://acs.examplebank.co.uk/challenge?creq=abc123456&id=9' }), {
    kind: 'CSP_BLOCKED', directive: 'frame-src', blockedOrigin: 'https://acs.examplebank.co.uk',
  });
  assert.equal(cspViolationReport({ violatedDirective: 'script-src', blockedURI: 'inline' }).blockedOrigin, 'inline');
  assert.equal(cspViolationReport({ effectiveDirective: 'img-src', blockedURI: 'data:image/png;base64,AAAA' }).blockedOrigin, 'data:');
});
