import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

// The opening-hours save answers in the admin's interface language, from the
// validator's CODE — the English sentence is never matched or translated.

function action(locale: Locale, options: { failWrite?: boolean } = {}) {
  const writes: unknown[] = [];
  const invalidated: string[] = [];
  const actions = loadServerModule<typeof import('./admin-availability')>('src/app/actions/admin-availability.ts', {
    '@/app/lib/prisma': { __esModule: true, default: {
      availability: { upsert: (query: unknown) => query },
      $transaction: async (queries: unknown[]) => {
        if (options.failWrite) throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'P1017' });
        writes.push(...queries); return queries;
      },
    } },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin', role: 'ADMIN' }) },
    '@/i18n/request': { getActionT: async (namespace: 'adminSchedule') => translator(locale, namespace) },
    'next/cache': { revalidatePath: (path: string) => { invalidated.push(path); }, updateTag: (tag: string) => { invalidated.push(tag); } },
  });
  return { save: actions.updateStylistAvailability, writes, invalidated };
}

function week(overrides: Record<number, Partial<Record<'open' | 'start' | 'end', string>>> = {}, stylistId = 'stylist-1') {
  const form = new FormData();
  if (stylistId) form.set('stylistId', stylistId);
  for (let day = 0; day <= 6; day++) {
    const values = { open: 'on', start: '10:00', end: '19:00', ...overrides[day] };
    if (values.open) form.set(`open-${day}`, values.open);
    form.set(`start-${day}`, values.start);
    form.set(`end-${day}`, values.end);
  }
  return form;
}

test('an English admin keeps the validator\'s exact wording', async () => {
  const { save, writes } = action('en-GB');
  const result = await save({ status: 'idle' }, week({ 2: { start: '18:00', end: '09:00' } }));
  assert.deepEqual(result, { status: 'error', message: 'Tuesday: the closing time must be after the opening time.' });
  assert.equal(writes.length, 0);
});

test('a Chinese admin gets the same refusal in Chinese, naming the day', async () => {
  const { save, writes } = action('zh-HK');
  assert.deepEqual(await save({ status: 'idle' }, week({ 2: { start: '18:00', end: '09:00' } })), { status: 'error', message: '星期二：結束時間必須遲於開始時間。' });
  assert.deepEqual(await save({ status: 'idle' }, week({ 5: { start: '9am' } })), { status: 'error', message: '星期五：營業時間必須是 09:30 這類格式。' });
  assert.deepEqual(await save({ status: 'idle' }, week({}, '')), { status: 'error', message: '缺少髮型師。' });
  assert.equal(writes.length, 0);
});

test('a valid week still saves', async () => {
  const { save, writes } = action('zh-HK');
  assert.deepEqual(await save({ status: 'idle' }, week({ 3: { open: '' } })), { status: 'success' });
  assert.equal(writes.length, 7);
});

// A database blip used to throw out of the action into the error boundary,
// replacing the form and losing the week being edited.
test('a failed save answers with a retryable error instead of crashing the page', async (t) => {
  const logged = t.mock.method(console, 'error', () => undefined);
  const en = action('en-GB', { failWrite: true });
  assert.deepEqual(await en.save({ status: 'idle' }, week()), { status: 'error', message: 'The opening hours could not be saved. Your changes are still here — please try again.' });
  assert.deepEqual(en.invalidated, [], 'nothing was saved, so no cache is dropped');
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual(logged.mock.calls[0].arguments[1], { stylistId: 'stylist-1', error: 'Error', code: 'P1017' });
  const zh = action('zh-HK', { failWrite: true });
  assert.deepEqual(await zh.save({ status: 'idle' }, week()), { status: 'error', message: '未能儲存營業時間。你的修改仍然保留，請再試一次。' });
});
