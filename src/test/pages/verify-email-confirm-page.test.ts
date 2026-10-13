import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { createEmailVerificationToken } from '../../app/lib/email-verification';
import { translator, type Namespace } from '../../i18n/messages';

type Element = { type: unknown; props: Record<string, unknown> };

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function withSecret(t: TestContext) {
  const prior = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'confirm-page-test-session-secret-32-chars';
  t.after(() => { if (prior === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prior; });
}

const ConfirmEmailForm = () => null;

function confirmPage() {
  return loadServerModule<typeof import('../../app/[locale]/auth/verify-email/confirm/page')>('src/app/[locale]/auth/verify-email/confirm/page.tsx', {
    'next/navigation': { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    '@/components/auth/ConfirmEmailForm': { ConfirmEmailForm },
    '@/i18n/server': { getLocale: async () => 'zh-HK', getT: async (namespace: Namespace) => translator('zh-HK', namespace) },
  });
}

test('a genuine link shows a confirm button for its address', async (t) => {
  withSecret(t);
  const token = await createEmailVerificationToken({ id: 'user-1', email: 'client@example.invalid' }, 'zh-HK');
  const nodes = elements(await confirmPage().default({ searchParams: Promise.resolve({ token }) }));
  const form = nodes.find((node) => node.type === ConfirmEmailForm);
  assert.ok(form, 'the page offers the button');
  assert.equal(form.props.token, token);
  assert.ok(nodes.some((node) => node.props.children === translator('zh-HK', 'auth')('verifyEmail.confirmBody', { email: 'client@example.invalid' })));
});

for (const [label, token] of [['a forged', 'not-a-token'], ['a missing', undefined], ['a repeated', ['a', 'b']]] as const) {
  test(`${label} token goes to the "not valid" outcome in the page's language`, async (t) => {
    withSecret(t);
    await assert.rejects(
      confirmPage().default({ searchParams: Promise.resolve({ token: token as string | string[] | undefined }) }),
      /^Error: redirect:\/zh-hk\/auth\/verify-email\?status=invalid$/,
    );
  });
}

test('the page is never indexed and never leaks its token', async () => {
  const metadata = await confirmPage().generateMetadata();
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(metadata.referrer, 'no-referrer');
  assert.equal(metadata.alternates?.canonical, '/zh-hk/auth/verify-email/confirm');
});
