import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDraft, reviewMark, sanitizeFields, type BilingualFields } from './review';

const faq = (question: string, answer: string) => ({ question, answer });

test('a translation is publishable only when both languages are complete and checked against each other', () => {
  const fields: BilingualFields = { 'en-GB': faq('Q?', 'A.'), 'zh-HK': faq('問？', '答。') };
  assert.equal(evaluateDraft('FAQ', fields, {}).publishable, false, 'nothing checked yet');
  const review = { 'en-GB': reviewMark('FAQ', fields, 'en-GB'), 'zh-HK': reviewMark('FAQ', fields, 'zh-HK') };
  assert.equal(evaluateDraft('FAQ', fields, review).publishable, true);
});

test('editing English makes the existing Chinese need re-checking, even though it is not empty', () => {
  const before: BilingualFields = { 'en-GB': faq('Q?', 'A.'), 'zh-HK': faq('問？', '答。') };
  const review = { 'en-GB': reviewMark('FAQ', before, 'en-GB'), 'zh-HK': reviewMark('FAQ', before, 'zh-HK') };
  const after: BilingualFields = { ...before, 'en-GB': faq('Q?', 'A new answer.') };
  const evaluation = evaluateDraft('FAQ', after, review);
  assert.equal(evaluation.locales['zh-HK'].reviewed, false);
  assert.equal(evaluation.locales['zh-HK'].needsReview, true);
  assert.equal(evaluation.locales['en-GB'].reviewed, false, 'the edited language needs its own check too');
  assert.equal(evaluation.publishable, false);
});

test('a missing required field in either language blocks publishing', () => {
  const fields: BilingualFields = { 'en-GB': faq('Q?', 'A.'), 'zh-HK': faq('問？', '') };
  const review = { 'en-GB': reviewMark('FAQ', fields, 'en-GB'), 'zh-HK': reviewMark('FAQ', fields, 'zh-HK') };
  const evaluation = evaluateDraft('FAQ', fields, review);
  assert.deepEqual(evaluation.locales['zh-HK'].missing, ['answer']);
  assert.equal(evaluation.publishable, false);
});

test('blank list rows are dropped and half-written rows block publishing', () => {
  const cleaned = sanitizeFields('CATEGORY_CONTENT', { faqs: [faq('', ''), faq('Only a question', '')], process: [{ step: '', detail: '' }], overview: ['', 'Para'] });
  assert.deepEqual(cleaned.faqs, [faq('Only a question', '')]);
  assert.deepEqual(cleaned.process, []);
  assert.deepEqual(cleaned.overview, ['Para']);
  const base = { title: 'T', hero: 'H', metaDescription: 'M', intro: 'I' };
  const fields: BilingualFields = { 'en-GB': { ...base, ...cleaned }, 'zh-HK': { ...base, faqs: [faq('問', '答')] } };
  const evaluation = evaluateDraft('CATEGORY_CONTENT', fields, {});
  assert.ok(evaluation.locales['en-GB'].missing.includes('faqs'));
});

test('untrusted editor input is reduced to the declared field shapes', () => {
  const cleaned = sanitizeFields('BLOG_POST', { title: 'T', sections: [{ type: 'script', text: 'x' }, { type: 'quote', text: 'Q', attribution: 'Ivan' }, { type: 'list', items: ['a', '', 'b'] }], evil: 'x' });
  assert.deepEqual(cleaned.sections, [{ type: 'quote', text: 'Q', attribution: 'Ivan' }, { type: 'list', items: ['a', 'b'] }]);
  assert.equal('evil' in cleaned, false);
});
