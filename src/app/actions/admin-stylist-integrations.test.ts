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
