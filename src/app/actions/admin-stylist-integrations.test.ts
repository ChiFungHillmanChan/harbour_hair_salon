import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

for (const legacyInput of [undefined, 'https://old-editor.example.test/calendar.ics']) {
  test(`editing a stylist ${legacyInput ? 'with an obsolete calendar field' : 'without a calendar field'} preserves the migrated legacy value`, async () => {
    const stylist = { id: 'stylist-1', slug: 'stylist', name: 'Old name', treatwellIcalUrl: 'https://migration-source.example.test/private.ics', treatwellExternalId: null };
    const actions = loadServerModule<typeof import('./admin-stylists')>('src/app/actions/admin-stylists.ts', {
      '@/app/lib/prisma': { stylist: {
        findUnique: async () => ({ ...stylist }),
        update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(stylist, data); return stylist; },
      } },
      '@/app/lib/session': { verifySession: async () => ({ role: 'ADMIN' }) },
      '@/app/stylists/slug': { slugify: () => 'stylist' },
      '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
      'next/cache': { revalidatePath: () => undefined },
      'next/navigation': {},
    });
    const form = new FormData();
    form.set('id', stylist.id); form.set('name', 'New name'); form.set('role', 'Stylist');
    if (legacyInput) form.set('treatwellIcalUrl', legacyInput);
    const result = await actions.updateStylist({ status: 'idle' }, form);
    assert.equal(result.status, 'success');
    assert.equal(stylist.name, 'New name');
    assert.equal(stylist.treatwellIcalUrl, 'https://migration-source.example.test/private.ics');
  });
}

test('deleting a stylist retires their outbound feed token immediately', async () => {
  // The token cache has no short timer, so without this the deleted stylist's
  // feed URL keeps answering until the week-long safety net expires.
  const calls: string[] = [];
  const stylist = { findUnique: async () => ({ slug: 'gone' }), delete: async () => { calls.push('delete'); return { id: 'stylist-1' }; } };
  // The profile's translations and drafts are removed in the same transaction.
  const tx = {
    stylist,
    contentTranslation: { deleteMany: async () => { calls.push('translations'); return { count: 2 }; } },
    contentDraft: { deleteMany: async () => { calls.push('drafts'); return { count: 0 }; } },
  };
  const actions = loadServerModule<typeof import('./admin-stylists')>('src/app/actions/admin-stylists.ts', {
    '@/app/lib/prisma': {
      stylist,
      appointment: { count: async () => 0 },
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
    '@/app/lib/session': { verifySession: async () => ({ role: 'ADMIN' }) },
    '@/app/stylists/slug': { slugify: () => 'gone' },
    '@/app/services/stylist-ical-cache': {
      invalidateStylistIcalFeed: () => undefined,
      invalidateStylistIcalToken: () => { calls.push('token'); },
    },
    'next/cache': { revalidatePath: () => undefined, updateTag: () => undefined },
    'next/navigation': {},
  });
  const form = new FormData();
  form.set('id', 'stylist-1');
  await actions.deleteStylist(form);
  assert.deepEqual(calls, ['translations', 'drafts', 'delete', 'token']);
});
