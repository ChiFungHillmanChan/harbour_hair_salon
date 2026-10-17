import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

// Admin → Employees → "Also add as stylist" (owner, 2026-10-17).
function load(slugs: string[] = []) {
  const published: { type: string; input: { fields: unknown; confirmedReviewed: boolean; adminId: string | null } }[] = [];
  const created: Record<string, unknown>[] = [];
  const tx = {
    stylist: {
      findMany: async ({ where }: { where: { slug: { startsWith: string } } }) => slugs.filter((slug) => slug.startsWith(where.slug.startsWith)).map((slug) => ({ slug })),
      create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'new-stylist' }; },
    },
  };
  const audits: Record<string, unknown>[] = [];
  const service = loadServerModule<typeof import('./stylist-from-employee')>('src/app/services/stylist-from-employee.ts', {
    '@/app/lib/audit': { appendAuditEvent: async (event: Record<string, unknown>) => { audits.push(event); } },
    '@/app/services/content/drafts': {
      createPublished: async (_db: unknown, type: string, input: typeof published[number]['input'], create: (english: Record<string, unknown>) => Promise<{ id: string }>) => {
        published.push({ type, input });
        return create((input.fields as Record<string, Record<string, unknown>>)['en-GB']);
      },
    },
  });
  return { create: (name: string, title: string) => service.createStylistForEmployee(tx as never, { name, title, adminId: 'admin' }), published, created, audits };
}

test('the stylist takes the employee’s name, is hidden from the website, and has the job title as its role in both languages', async () => {
  const f = load();
  assert.equal(await f.create(' Mei Chan ', ' Assistant '), 'new-stylist');
  assert.deepEqual(f.created, [{ name: 'Mei Chan', slug: 'mei-chan', role: 'Assistant', showOnWebsite: false }]);
  assert.deepEqual(f.published, [{
    type: 'STYLIST',
    input: { fields: { 'en-GB': { role: 'Assistant' }, 'zh-HK': { role: 'Assistant' } }, confirmedReviewed: true, adminId: 'admin' },
  }]);
  assert.deepEqual(f.audits, [{ actorUserId: 'admin', action: 'STYLIST.CREATED_FOR_EMPLOYEE', targetType: 'Stylist', targetId: 'new-stylist', metadata: { showOnWebsite: false } }]);
});

test('a taken address gets the next free number', async () => {
  const f = load(['mei', 'mei-2', 'meiling']);
  await f.create('Mei', 'Assistant');
  assert.equal(f.created[0].slug, 'mei-3');
});

test('a name with no Latin letters still gets an address', async () => {
  const f = load(['stylist']);
  await f.create('天天', 'Assistant');
  assert.equal(f.created[0].slug, 'stylist-2');
});
