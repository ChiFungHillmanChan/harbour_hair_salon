import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const { loadDiaryConfig } = loadServerModule<typeof import('./google-diary-config')>('src/app/services/google-diary-config.ts', {
  '@/app/lib/prisma': new Proxy({}, { get() { throw new Error('default client used'); } }),
});

function db(settings: Record<string, unknown> | null) {
  const asked: Record<string, unknown>[] = [];
  return {
    asked,
    client: {
      stylist: { findMany: async (args: Record<string, unknown>) => { asked.push(args); return [{ id: 'lox', name: 'Lox', googleColorId: '5', googleAliases: 'L' }]; } },
      siteSettings: { findUnique: async () => settings },
    },
  };
}

test('the diary config: active stylists with their Google colour and names, and the live salon colours', async () => {
  const f = db({ googleUnassignedColorId: '4', googleLeaveColorId: '9' });
  assert.deepEqual(await loadDiaryConfig(f.client as never), {
    stylists: [{ id: 'lox', name: 'Lox', googleColorId: '5', googleAliases: 'L' }], unassignedColorId: '4', leaveColorId: '9',
  });
  assert.deepEqual((f.asked[0] as { where: unknown }).where, { isActive: true });
});

test('no settings row, or a value that is not a Google colour id: Tomato and Graphite', async () => {
  for (const settings of [null, { googleUnassignedColorId: '', googleLeaveColorId: '12' }]) {
    const config = await loadDiaryConfig(db(settings).client as never);
    assert.deepEqual([config.unassignedColorId, config.leaveColorId], ['11', '8']);
  }
});
