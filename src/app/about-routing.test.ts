import test from 'node:test';
import assert from 'node:assert/strict';
import { permanentRedirect, redirect } from 'next/dist/client/components/redirect';
import { loadServerModule } from '../test/load-server-module';
import type { Locale } from '../i18n/config';

for (const [locale, destination] of [
  ['en-GB', '/about#salon-tour'],
  ['zh-HK', '/zh-hk/about#salon-tour'],
] as const satisfies readonly (readonly [Locale, string])[]) {
  test(`legacy tour redirects permanently to its ${locale} About section`, async () => {
    const { default: Salon3DPage } = loadServerModule<typeof import('./[locale]/3d/page')>('src/app/[locale]/3d/page.tsx', {
      '@/i18n/server': { getLocale: async () => locale },
      // Next's real redirects without importing client-only router hooks.
      'next/navigation': { permanentRedirect, redirect },
    });

    await assert.rejects(Salon3DPage(), (error: unknown) => {
      assert.ok(error instanceof Error && 'digest' in error);
      // An accidental temporary redirect or a lost locale must fail.
      assert.equal(error.digest, `NEXT_REDIRECT;replace;${destination};308;`);
      return true;
    });
  });
}
