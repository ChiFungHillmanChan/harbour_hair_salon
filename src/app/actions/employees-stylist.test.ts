import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

// Admin → Employees → "Also add as stylist" (owner, 2026-10-17): the new
// stylist is made and linked in the same transaction as the employee.
function load(existing: { stylistId: string | null } | null = { stylistId: null }, raceLinked = false) {
  const writes: { op: string; data: Record<string, unknown> }[] = [];
  const made: { name: string; title: string }[] = [];
  const tx = {
    employee: {
      create: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ op: 'create', data }); return { id: 'e1' }; },
      update: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ op: 'update', data }); return { id: 'e1' }; },
      // The guarded link: only an employee still without a stylist (raceLinked: someone else linked one first).
      updateMany: async ({ where, data }: { where: { stylistId: null }; data: Record<string, unknown> }) => {
        if (where.stylistId !== null || raceLinked) return { count: 0 };
        writes.push({ op: 'update', data });
        return { count: 1 };
      },
    },
  };
  const actions = loadServerModule<typeof import('./employees')>('src/app/actions/employees.ts', {
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin', role: 'ADMIN' }) },
    '@/app/lib/audited-write': { auditedWrite: async (_event: unknown, mutate: (db: typeof tx) => Promise<unknown>) => mutate(tx) },
    '@/app/lib/prisma': { employee: { findUnique: async () => existing } },
    '@/app/lib/pin': { isValidPin: () => true, hashPin: async () => 'hash' },
    '@/app/services/stylist-from-employee': {
      createStylistForEmployee: async (_db: unknown, input: { name: string; title: string }) => { made.push({ name: input.name, title: input.title }); return 'new-stylist'; },
    },
    '@/i18n/request': { getActionT: async (namespace: Namespace) => translator('en-GB', namespace) },
    'next/cache': { revalidatePath: () => undefined },
  });
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    data.set('name', 'Mei'); data.set('title', 'Assistant'); data.set('payType', 'HOURLY'); data.set('pin', '1234');
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  return { actions, form, writes, made };
}

test('adding an employee with "Also add as stylist" makes a stylist from their name and title, and links it', async () => {
  const f = load();
  assert.deepEqual(await f.actions.createEmployee(f.form({ addAsStylist: 'on' })), { success: true });
  assert.deepEqual(f.made, [{ name: 'Mei', title: 'Assistant' }]);
  assert.equal(f.writes[0].data.stylistId, 'new-stylist');
});

test('without the box nothing extra is made; with a stylist picked as well it is refused', async () => {
  const f = load();
  await f.actions.createEmployee(f.form({ stylistId: 'ivan' }));
  assert.deepEqual([f.made.length, f.writes[0].data.stylistId], [0, 'ivan']);
  const both = await f.actions.createEmployee(f.form({ addAsStylist: 'on', stylistId: 'ivan' }));
  assert.match(both.error ?? '', /not both/);
  assert.equal(f.writes.length, 1);
});

test('editing an employee with no stylist can add one; one already linked is refused', async () => {
  const unlinked = load({ stylistId: null });
  assert.deepEqual(await unlinked.actions.updateEmployee('e1', unlinked.form({ addAsStylist: 'on' })), { success: true });
  assert.equal(unlinked.writes[0].data.stylistId, 'new-stylist');
  const linked = load({ stylistId: 'ivan' });
  const refused = await linked.actions.updateEmployee('e1', linked.form({ addAsStylist: 'on' }));
  assert.match(refused.error ?? '', /already linked/);
  assert.deepEqual([linked.made.length, linked.writes.length], [0, 0]);
});

test('a second save racing the first (a stylist linked meanwhile) is refused, so its own new stylist is rolled back', async () => {
  const f = load({ stylistId: null }, true);
  const refused = await f.actions.updateEmployee('e1', f.form({ addAsStylist: 'on' }));
  assert.match(refused.error ?? '', /already linked/);
  assert.equal(f.writes.length, 0);
});

test('a title of only spaces is refused before anything is made', async () => {
  const f = load();
  const refused = await f.actions.createEmployee(f.form({ addAsStylist: 'on', title: '   ' }));
  assert.ok(refused.error);
  assert.deepEqual([f.made.length, f.writes.length], [0, 0]);
});

test('a PIN is hashed before the transaction opens, never while it holds a connection', async () => {
  const order: string[] = [];
  const tx = {
    employee: {
      create: async () => { order.push('write'); return { id: 'e1' }; },
      update: async () => { order.push('write'); return { id: 'e1' }; },
    },
  };
  const actions = loadServerModule<typeof import('./employees')>('src/app/actions/employees.ts', {
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin', role: 'ADMIN' }) },
    '@/app/lib/audited-write': { auditedWrite: async (_event: unknown, mutate: (db: typeof tx) => Promise<unknown>) => {
      order.push('transaction');
      try { return await mutate(tx); } finally { order.push('commit'); }
    } },
    '@/app/lib/prisma': {},
    '@/app/lib/pin': { isValidPin: () => true, hashPin: async () => { order.push('hash'); return 'hash'; } },
    '@/app/services/stylist-from-employee': {},
    '@/i18n/request': { getActionT: async (namespace: Namespace) => translator('en-GB', namespace) },
    'next/cache': { revalidatePath: () => undefined },
  });
  const data = new FormData();
  data.set('name', 'Mei'); data.set('title', 'Assistant'); data.set('payType', 'HOURLY'); data.set('pin', '1234');

  assert.deepEqual(await actions.createEmployee(data), { success: true });
  assert.deepEqual(order, ['hash', 'transaction', 'write', 'commit']);
  order.length = 0;
  assert.deepEqual(await actions.setEmployeePin('e1', '4321'), { success: true });
  assert.deepEqual(order, ['hash', 'transaction', 'write', 'commit']);
});

