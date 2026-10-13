import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}

function fixture(storedPrice = '50.00') {
  const updates: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  const tx = { service: { create: async ({ data }: { data: Record<string, unknown> }) => { creates.push(data); return { id: 'new-service' }; } } };
  const actions = loadServerModule<typeof import('./admin-services')>('src/app/actions/admin-services.ts', {
    '@/app/lib/prisma': {
      service: {
        findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'cut' ? { id: 'cut', price: storedPrice } : null),
        update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { id: 'cut' }; },
      },
      serviceOffering: { findUnique: async () => null },
      $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx),
    },
    '@/app/lib/session': { verifySession: async () => ({ role: 'ADMIN', userId: 'admin1' }) },
    '@/app/services/category-content-service': { getAllCategoryContent: async () => [] },
    '@/app/services/content/drafts': {
      ContentError: class ContentError extends Error {},
      deleteContent: async () => undefined,
      createPublished: async (_tx: unknown, _type: string, _input: unknown, write: (english: Record<string, string>) => Promise<unknown>) =>
        write({ name: 'Cut', description: '', priceNote: '' }),
    },
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect: (url: string) => { throw new Redirected(url); } },
  });
  return { actions, updates, creates };
}

function serviceForm(fields: Record<string, string>) {
  const form = new FormData();
  form.set('duration', '60');
  form.set('category', 'Haircuts');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

const errorText = (state: { status: string; message?: string }) => (state.status === 'error' ? state.message : state.status);

test('the deposit box: empty follows the salon policy, 0 means none, otherwise a fixed amount in pounds', async () => {
  for (const [typed, stored] of [['', null], ['   ', null], ['0', 0], ['12.50', 1250], ['12.5', 1250], ['50', 5000]] as const) {
    const f = fixture();
    assert.deepEqual(await f.actions.updateService({ status: 'idle' }, serviceForm({ id: 'cut', depositOverride: typed })), { status: 'success' }, typed);
    assert.equal(f.updates.length, 1);
    assert.equal(f.updates[0].depositOverridePence, stored, typed);
  }
});

test('a fixed deposit above the published price is refused, and nothing is saved', async () => {
  const f = fixture('50.00');
  const state = await f.actions.updateService({ status: 'idle' }, serviceForm({ id: 'cut', depositOverride: '50.01' }));
  assert.equal(errorText(state), 'The deposit cannot be more than the service price.');
  assert.deepEqual(f.updates, []);
});

test('a deposit that is not an amount in pounds is refused, and nothing is saved', async () => {
  for (const typed of ['abc', '-1', '1.234', '£5', '5p', '1234567']) {
    const f = fixture();
    const state = await f.actions.updateService({ status: 'idle' }, serviceForm({ id: 'cut', depositOverride: typed }));
    assert.equal(errorText(state), 'Enter the deposit in pounds, e.g. 10 or 12.50, or leave it empty to follow the salon policy.', typed);
    assert.deepEqual(f.updates, [], typed);
  }
});

test('a form without the deposit box (a page opened before it existed) leaves the stored deposit alone', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.updateService({ status: 'idle' }, serviceForm({ id: 'cut' })), { status: 'success' });
  assert.equal(f.updates[0].depositOverridePence, undefined, 'undefined is "no change" to Prisma');
  assert.equal('depositOverride' in f.updates[0], false, 'the pounds box is not a column');
});

test('a new service checks its deposit against the price typed with it', async () => {
  const refused = fixture();
  const state = await refused.actions.createService({ status: 'idle' }, serviceForm({ price: '40', depositOverride: '45' }));
  assert.equal(errorText(state), 'The deposit cannot be more than the service price.');
  assert.deepEqual(refused.creates, []);

  for (const [typed, stored] of [['10', 1000], ['', null], ['0', 0]] as const) {
    const created = fixture();
    await assert.rejects(created.actions.createService({ status: 'idle' }, serviceForm({ price: '40', depositOverride: typed })), Redirected);
    assert.equal(created.creates.length, 1);
    assert.equal(created.creates[0].depositOverridePence, stored, typed);
    assert.equal(created.creates[0].price, '40.00');
  }
});
