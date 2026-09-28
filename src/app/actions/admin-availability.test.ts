import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

// The opening-hours save answers in the admin's interface language, from the
// validator's CODE — the English sentence is never matched or translated.

function action(locale: Locale) {
  const writes: unknown[] = [];
  const actions = loadServerModule<typeof import('./admin-availability')>('src/app/actions/admin-availability.ts', {
    '@/app/lib/prisma': { __esModule: true, default: {
      availability: { upsert: (query: unknown) => query },
      $transaction: async (queries: unknown[]) => { writes.push(...queries); return queries; },
    } },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin', role: 'ADMIN' }) },
    '@/i18n/request': { getActionT: async (namespace: 'adminSchedule') => translator(locale, namespace) },
    'next/cache': { revalidatePath: () => undefined, updateTag: () => undefined },
  });
  return { save: actions.updateStylistAvailability, writes };
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
