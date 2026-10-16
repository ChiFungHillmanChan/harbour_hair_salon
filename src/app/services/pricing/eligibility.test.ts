import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiresEligibilityProof } from './eligibility';
import { translator } from '../../../i18n/messages';

test('only NHS-priced options need proof of eligibility', () => {
  for (const [priceType, expected] of [['NHS', true], ['STANDARD', false], ['', false], ['nhs', false]] as const) {
    assert.equal(requiresEligibilityProof({ priceType }), expected, priceType);
  }
});

test('the eligibility notice reads as agreed in both languages', () => {
  assert.equal(
    translator('en-GB', 'pricing')('eligibilityProof'),
    'NHS and student prices: please bring a valid NHS staff ID or student card to your appointment. Without one, the standard price applies.',
  );
  assert.equal(
    translator('zh-HK', 'pricing')('eligibilityProof'),
    'NHS 及學生價：到店時請出示有效的 NHS 員工證或學生證，否則按標準價收費。',
  );
});
