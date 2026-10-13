import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATIONS_MESSAGES, operationsMessageKey, type OperationsMessageKey } from './operations-messages';
import { translator } from '@/i18n/messages';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

const code = sources('src/app').filter((file) => !file.endsWith('operations-messages.ts')).map((file) => readFileSync(file, 'utf8')).join('\n');

test('every catalogued message is still written somewhere', () => {
  for (const [key, message] of Object.entries(OPERATIONS_MESSAGES)) {
    assert.ok(code.includes(`'${message}'`) || code.includes(`OPERATIONS_MESSAGES.${key}`), `${key} is no longer written by any job`);
  }
});

test('every fixed lastError sentence a job writes is catalogued (so Operations can translate it)', () => {
  const known = new Set<string>(Object.values(OPERATIONS_MESSAGES));
  const written = [...code.matchAll(/lastError: (?:[^'\n]*\? )?'([^']+)'(?: : '([^']+)')?/g)].flatMap((m) => [m[1], m[2]]).filter((m): m is string => Boolean(m));
  assert.ok(written.length >= 5, 'the scan found the writers');
  for (const message of written) assert.ok(known.has(message), `uncatalogued lastError: ${message}`);
});

/**
 * Review I-F. These sentences are STATE KEYS as well as words: rows are found,
 * or told apart, by their exact text — a Prisma `where`, or an `===` / `!==`
 * check — not only translated for Admin → Operations. Changing the text of one
 * silently drops every row already carrying the old text out of
 * reconciliation, the attention list, the daily email or a replayed answer.
 * NEVER edit one of these in place: add a new key (and a migration, or code
 * that still recognises the old text) instead. Where each is read:
 */
const STATE_KEY_SENTENCES: Partial<Record<OperationsMessageKey, string>> = {
  // where: payment-attention.ts (card declines in the last day).
  PAYMENT_DECLINED: 'Square declined the deposit, or the card could not be verified. Nothing was booked or charged.',
  // ===: payment-attempts.ts replayAnswer.
  PAYMENT_NOT_SENT: 'Square payments were unavailable, so the deposit was never sent. Nothing was charged.',
  // where: payment-attention.ts (setup refusals in the last day); ===: payment-attempts.ts replayAnswer.
  PAYMENT_SETUP_REFUSED: 'Square refused the deposit request because of the Square setup on this website (access token, permissions or location), so nothing was held or charged. Check the Square configuration in Vercel.',
  // where: payment-reconciliation.ts (authorizations phase); ===: payment-reconciliation.ts act / cancelByKey,
  // square-webhook-events.ts paymentNoticeChange.
  PAYMENT_RELEASED_UNCONFIRMED: 'Square did not confirm the deposit authorization, so it was cancelled by its idempotency key. Nothing was booked.',
  // ===: payment-attempts.ts replayAnswer.
  PAYMENT_RELEASED_NOT_BOOKED: 'The booking could not be saved after the deposit was authorized, so the hold was released.',
  // ===: payment-attempts.ts replayAnswer.
  PAYMENT_RELEASE_FAILED: 'Releasing this deposit hold failed. Re-check the payment; Square cancels an uncaptured hold when it expires.',
  // where: payment-reconciliation.ts (expiries phase); ===: payment-reconciliation.ts act.
  PAYMENT_HOLD_EXPIRED: 'The card hold expired before the request was confirmed, so the request was closed. Nothing was taken.',
  // ===: payment-reconciliation.ts act.
  PAYMENT_MISMATCH: 'The payment Square holds does not match this deposit (amount or reference), so it was not taken. Check it in Square.',
  // ===: payment-reconciliation.ts afterCaptureSettled.
  PAYMENT_CAPTURED_NOT_CONFIRMED: 'The deposit was taken but the booking was not confirmed. Confirm the request again (the deposit is not taken twice), or decline it to refund the deposit.',
  // ===: payment-reconciliation.ts depositState.
  PAYMENT_LATE_CAPTURE_REFUNDED: 'Square took this deposit although its booking had closed or was never made, so it is being refunded in full.',
  // where (not): payment-attention.ts; ===: payment-reconciliation.ts cancelByKey.
  PAYMENT_UNKNOWN_CANCELLING: 'Square never confirmed this deposit authorization. It is cancelled by its idempotency key again every day until any hold would have run out (7 days). Nothing was booked.',
};

test('every sentence used as a state key keeps its exact text (change one and existing rows drop out — add a key and a migration instead)', () => {
  for (const [key, text] of Object.entries(STATE_KEY_SENTENCES)) {
    assert.equal(OPERATIONS_MESSAGES[key as OperationsMessageKey], text, `${key} is read back as a state key: never reword it in place`);
  }
});

test('every catalogued sentence the code compares or filters on is pinned as a state key', () => {
  const read = new Set<string>();
  // Equality checks and Prisma `not` filters.
  for (const match of code.matchAll(/[!=]==\s*OPERATIONS_MESSAGES\.([A-Z_]+)|OPERATIONS_MESSAGES\.([A-Z_]+)\s*[!=]==|not:\s*OPERATIONS_MESSAGES\.([A-Z_]+)/g)) {
    read.add(match[1] ?? match[2] ?? match[3]);
  }
  // A Prisma filter on one line: `where: { … lastError: OPERATIONS_MESSAGES.X … }` before any `data:`.
  // (Filters spread over several lines are listed above by hand.)
  for (const line of code.split('\n')) {
    const where = line.indexOf('where:');
    if (where === -1) continue;
    const data = line.indexOf('data:', where);
    for (const match of line.matchAll(/lastError:\s*OPERATIONS_MESSAGES\.([A-Z_]+)/g)) {
      if (match.index! > where && (data === -1 || match.index! < data)) read.add(match[1]);
    }
  }
  assert.ok(read.size >= 8, 'the scan found the readers');
  for (const key of read) assert.ok(key in STATE_KEY_SENTENCES, `${key} is read as a state key: pin its exact text in STATE_KEY_SENTENCES`);
});

test('recognised sentences map to a key with copy in both languages; anything else stays raw', () => {
  assert.equal(operationsMessageKey(OPERATIONS_MESSAGES.RETRY_WINDOW_EXPIRED), 'RETRY_WINDOW_EXPIRED');
  assert.equal(operationsMessageKey('ECONNRESET from feed host'), null);
  assert.equal(operationsMessageKey(null), null);
  for (const key of Object.keys(OPERATIONS_MESSAGES)) {
    for (const locale of ['en-GB', 'zh-HK'] as const) {
      const text = translator(locale, 'adminOps')(`operations.messages.${key}` as never);
      assert.ok(text && !text.startsWith('operations.messages.'), `${locale} ${key}`);
    }
  }
});
