import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import { LOCALE_COOKIE, type Locale } from '../../i18n/config';
import { SESSION_HINT_COOKIE } from '../../app/lib/session-hint';
import { LOGIN_DEVICE_COOKIE } from '../../app/lib/login-device';
import { GOOGLE_OAUTH_STATE_COOKIE } from '../../app/lib/google-oauth';
import { ADMIN_SESSION_SECONDS, CUSTOMER_SESSION_SECONDS } from '../../app/lib/session-policy';
import { EMAIL_VERIFICATION_TTL_HOURS } from '../../app/lib/email-verification';
import { RESET_TOKEN_TTL_MS } from '../../app/lib/password-reset';
import { UNSUBSCRIBE_TOKEN_TTL_DAYS } from '../../app/lib/unsubscribe-token';
import { EMAIL_SEND_DAILY_POLICY } from '../../app/lib/rate-limit';

type Element = { type: unknown; props: Record<string, unknown> };

/** Render the server tree, calling the page's own (hook-free) components. */
function render(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(render);
  if (!node || typeof node !== 'object' || !('props' in node)) return node;
  const element = node as Element;
  if (typeof element.type === 'function') return render((element.type as (props: unknown) => unknown)(element.props));
  return { ...element, props: { ...element.props, children: render(element.props.children) } };
}

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

async function privacyPage(locale: Locale) {
  const page = loadServerModule<typeof import('../../app/[locale]/privacy/page')>('src/app/[locale]/privacy/page.tsx', {
    '@/app/services/site-settings-service': { getSiteSettings: async () => ({ phone: '0113 496 0000' }) },
    '@/i18n/server': { getLocale: async () => locale, getT: async (namespace: Namespace) => translator(locale, namespace) },
    '@/i18n/link': (props: Record<string, unknown>) => ({ type: 'a', props }),
  });
  const tree = render(await page.default());
  return { nodes: elements(tree), text: text(tree), metadata: await page.generateMetadata() };
}

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`the ${locale} privacy notice renders every section, with nothing missing`, async () => {
    const t = translator(locale, 'legal');
    const page = await privacyPage(locale);
    assert.doesNotMatch(page.text, /privacy\.[a-zA-Z]+\./, 'no message key shows instead of its text');
    assert.doesNotMatch(page.text, /<\/?\w+>/, 'no rich-text tag shows as text');
    for (const section of ['who', 'collect', 'use', 'share', 'transfers', 'retention', 'rights', 'contact', 'cookies', 'automated', 'changes'] as const) {
      assert.ok(page.text.includes(t(`privacy.${section}.title`)), `${section} section`);
    }
    assert.ok(page.text.includes('0113 496 0000'), 'the salon phone from settings');
    assert.equal(page.metadata.title, t('privacy.meta.title'));

    const links = page.nodes.filter((node) => node.type === 'a').map((node) => node.props.href);
    assert.ok(links.includes('/contact'));
    assert.ok(links.includes('/unsubscribe'));
    assert.ok(links.includes('/booking-terms'));
    assert.ok(links.includes('https://ico.org.uk/make-a-complaint/'));
    assert.ok(page.text.includes('0303 123 1113'), 'the ICO helpline');
    assert.ok(!page.nodes.some((node) => node.props.id === 'contact'), 'the site footer already uses id="contact"');
  });
}

test('online deposits are covered: what is kept, why, who processes the card and for how long', async () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const t = translator(locale, 'legal');
    const { text: body } = await privacyPage(locale);
    const plain = (key: Parameters<typeof t>[0]) => t(key).replace(/<\/?\w+>/g, '');
    for (const key of ['privacy.collect.payments', 'privacy.use.payments', 'privacy.share.square', 'privacy.retention.payments', 'privacy.cookies.square'] as const) {
      assert.ok(body.includes(plain(key)), `${locale}: ${key}`);
    }
    assert.ok(plain('privacy.transfers.body').includes('Square'), `${locale}: Square among the international transfers`);
  }
  const en = (await privacyPage('en-GB')).text;
  assert.ok(en.includes('we never see or store your card number'));
  assert.ok(en.includes('up to 6 years after the payment'));
});

test('Square is described as an independent controller, not a processor acting for the salon', async () => {
  const en = (await privacyPage('en-GB')).text;
  assert.ok(en.includes('Square handles card payments and its fraud checks as an independent controller, under its own privacy notice — not on our behalf.'));
  // The other providers still act for the salon.
  assert.ok(en.includes('We share it only with these service providers. Unless we say otherwise below, they handle it on our behalf and under our instructions:'));
  const zh = (await privacyPage('zh-HK')).text;
  assert.ok(zh.includes('Square 以獨立控制者（independent controller）身分') && zh.includes('並非代表本店處理'));
  assert.ok(zh.includes('除下文另有說明外，他們代表我們並按我們的指示處理'));
});

test('the notice names every cookie the code sets for visitors', async () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const { text: body } = await privacyPage(locale);
    for (const name of ['session', SESSION_HINT_COOKIE, LOGIN_DEVICE_COOKIE, GOOGLE_OAUTH_STATE_COOKIE, LOCALE_COOKIE]) {
      assert.ok(body.includes(name), `${locale}: ${name}`);
    }
  }
});

test('the periods the notice states are the ones the code enforces', async () => {
  const en = (await privacyPage('en-GB')).text;
  assert.ok(en.includes('Last updated: 13 October 2026'));
  assert.ok(en.includes(`email confirmation after ${EMAIL_VERIFICATION_TTL_HOURS} hours`));
  assert.ok(en.includes(`password reset after ${RESET_TOKEN_TTL_MS / 3_600_000} hour`));
  assert.ok(en.includes(`unsubscribe after ${UNSUBSCRIBE_TOKEN_TTL_DAYS} days`));
  assert.ok(en.includes(`Up to ${CUSTOMER_SESSION_SECONDS / 86_400} days (${ADMIN_SESSION_SECONDS / 3_600} hours for staff)`));
  // Upstash keeps a sliding-window key for up to twice its window: the longest
  // client-address window (the daily email budget) is gone within 2 days.
  assert.ok(en.includes(`within ${(EMAIL_SEND_DAILY_POLICY.windowSeconds * 2) / 86_400} days`));

  const zh = (await privacyPage('zh-HK')).text;
  assert.ok(zh.includes(`電郵確認連結為 ${EMAIL_VERIFICATION_TTL_HOURS} 小時`));
  assert.ok(zh.includes(`重設密碼連結為 ${RESET_TOKEN_TTL_MS / 3_600_000} 小時`));
  assert.ok(zh.includes(`取消訂閱連結為 ${UNSUBSCRIBE_TOKEN_TTL_DAYS} 日`));
  assert.ok(zh.includes(`最長 ${CUSTOMER_SESSION_SECONDS / 86_400} 日（員工為 ${ADMIN_SESSION_SECONDS / 3_600} 小時）`));
  assert.ok(zh.includes(`於 ${(EMAIL_SEND_DAILY_POLICY.windowSeconds * 2) / 86_400} 日內自動刪除`));
});
