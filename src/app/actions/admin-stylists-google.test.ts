import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

type Holder = { id: string; name: string; isActive: boolean; googleColorId: string | null };
function load(holders: Holder[] = [], settings: { googleUnassignedColorId: string; googleLeaveColorId: string } | null = { googleUnassignedColorId: '11', googleLeaveColorId: '8' }) {
  const updates: Record<string, unknown>[] = [];
  const actions = loadServerModule<typeof import('./admin-stylists')>('src/app/actions/admin-stylists.ts', {
    '@/app/lib/prisma': {
      stylist: {
        findUnique: async () => ({ id: 'lox', slug: 'lox' }),
        findFirst: async ({ where }: { where: { isActive: boolean; googleColorId: string; id?: { not: string } } }) => {
          const holder = holders.find((s) => s.isActive === where.isActive && s.googleColorId === where.googleColorId && s.id !== where.id?.not);
          return holder ? { name: holder.name } : null;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { id: 'lox' }; },
      },
      siteSettings: { findUnique: async () => settings },
    },
    '@/app/lib/session': { verifySession: async () => ({ role: 'ADMIN' }) },
    '@/app/stylists/slug': { slugify: () => 'lox' },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    '@/i18n/request': { getActionT: async (namespace: Namespace) => translator('en-GB', namespace), localizedPath: async (path: string) => path },
    'next/cache': { revalidatePath: () => undefined },
    'next/navigation': {},
  });
  const save = (fields: Record<string, string>) => {
    const form = new FormData();
    form.set('id', 'lox'); form.set('name', 'Lox');
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return actions.updateStylist({ status: 'idle' }, form);
  };
  return { save, updates };
}

test('a Google colour and names are saved, the names normalised', async () => {
  const f = load();
  assert.deepEqual(await f.save({ googleColorId: '5', googleAliases: ' L , l, Lox ' }), { status: 'success' });
  assert.deepEqual([f.updates[0].googleColorId, f.updates[0].googleAliases], ['5', 'L, Lox']);
});

test('no colour and no names save as null', async () => {
  const f = load();
  await f.save({ googleColorId: '', googleAliases: '  ' });
  assert.deepEqual([f.updates[0].googleColorId, f.updates[0].googleAliases], [null, null]);
});

test('another active stylist’s colour is refused, naming them; a retired holder or the stylist’s own colour is fine', async () => {
  const taken = await load([{ id: 'ivan', name: 'Ivan', isActive: true, googleColorId: '1' }]).save({ googleColorId: '1' });
  assert.equal(taken.status, 'error');
  assert.match((taken as { message: string }).message, /Ivan already uses this Google colour/);
  assert.equal((await load([{ id: 'ivan', name: 'Ivan', isActive: false, googleColorId: '1' }]).save({ googleColorId: '1' })).status, 'success');
  assert.equal((await load([{ id: 'lox', name: 'Lox', isActive: true, googleColorId: '5' }]).save({ googleColorId: '5' })).status, 'success');
});

test('the no-stylist and leave colours are reserved; an unknown id is refused; nothing is written', async () => {
  for (const [colour, words] of [['11', /set aside/], ['8', /set aside/], ['12', /Unknown Google colour/]] as const) {
    const f = load();
    const result = await f.save({ googleColorId: colour });
    assert.equal(result.status, 'error', colour);
    assert.match((result as { message: string }).message, words, colour);
    assert.equal(f.updates.length, 0, colour);
  }
});
