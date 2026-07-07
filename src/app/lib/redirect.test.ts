import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRedirect } from './redirect';

test('sanitizeRedirect — allows same-origin relative paths', () => {
  assert.equal(sanitizeRedirect('/book'), '/book');
  assert.equal(sanitizeRedirect('/appointments?tab=upcoming#top'), '/appointments?tab=upcoming#top');
});

test('sanitizeRedirect — falls back to / for empty/absolute/protocol-relative', () => {
  assert.equal(sanitizeRedirect(null), '/');
  assert.equal(sanitizeRedirect(''), '/');
  assert.equal(sanitizeRedirect('https://evil.com'), '/');
  assert.equal(sanitizeRedirect('//evil.com'), '/');
});

test('sanitizeRedirect — blocks backslash and control-character redirect tricks', () => {
  assert.equal(sanitizeRedirect('/\\evil.com'), '/'); // normalises to //evil.com in the URL parser
  assert.equal(sanitizeRedirect('/\tevil'), '/');
  assert.equal(sanitizeRedirect('/\nevil'), '/');
});
