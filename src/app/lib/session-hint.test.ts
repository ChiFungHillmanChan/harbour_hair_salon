import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionHint, SESSION_HINT_COOKIE } from './session-hint';

test('cookie name constant is stable (set server-side, read client-side)', () => {
  assert.equal(SESSION_HINT_COOKIE, 'session_hint');
});

test('returns null for an empty cookie string', () => {
  assert.equal(parseSessionHint(''), null);
});

test('returns null when no session_hint cookie is present', () => {
  assert.equal(parseSessionHint('theme=dark; _ga=GA1.2.123'), null);
});

test('returns the role when session_hint is the only cookie', () => {
  assert.equal(parseSessionHint('session_hint=USER'), 'USER');
});

test('returns the role when session_hint sits among other cookies', () => {
  assert.equal(parseSessionHint('theme=dark; session_hint=ADMIN; _ga=GA1.2.123'), 'ADMIN');
});

test('returns null for an empty session_hint value', () => {
  assert.equal(parseSessionHint('session_hint='), null);
});

test('does not match cookies whose name merely ends in session_hint', () => {
  assert.equal(parseSessionHint('xsession_hint=ADMIN'), null);
});

test('decodes URL-encoded values', () => {
  assert.equal(parseSessionHint('session_hint=US%45R'), 'USER');
});
