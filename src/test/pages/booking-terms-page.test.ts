import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';
import { CONSULTATION_CREDIT_MONTHS, LATE_ARRIVAL_CANCEL_MINUTES, MIN_BOOKING_NOTICE_MINUTES } from '../../app/lib/booking-constants';
import { PATCH_TEST_MIN_LEAD_HOURS } from '../../app/services/patch-test-eligibility';

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

const i18n = (locale: Locale) => ({
  getLocale: async () => locale,
  getT: async (namespace: Namespace) => translator(locale, namespace),
});
const link = (props: Record<string, unknown>) => ({ type: 'a', props });

function loadPage(locale: Locale) {
  return loadServerModule<typeof import('../../app/[locale]/booking-terms/page')>('src/app/[locale]/booking-terms/page.tsx', {
    '@/app/services/site-settings-service': { getSiteSettings: async () => ({ phone: '0113 496 0000' }) },
    '@/i18n/server': i18n(locale),
    '@/i18n/link': link,
  });
}

async function termsPage(locale: Locale) {
  const page = loadPage(locale);
  const tree = render(await page.default());
  return { nodes: elements(tree), text: text(tree), metadata: await page.generateMetadata() };
}

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`the ${locale} booking terms render every section, with nothing missing`, async () => {
    const t = translator(locale, 'legal');
    const page = await termsPage(locale);
    assert.doesNotMatch(page.text, /bookingTerms\.[a-zA-Z]+/, 'no message key shows instead of its text');
    assert.doesNotMatch(page.text, /<\/?\w+>/, 'no rich-text tag shows as text');
    assert.doesNotMatch(page.text, /\{\w+\}/, 'no placeholder is left unfilled');
    for (const section of ['requests', 'deposits', 'notConfirmed', 'cancelling', 'refunds', 'changes', 'offers', 'patchTests', 'rights', 'contact'] as const) {
      assert.ok(page.text.includes(t(`bookingTerms.${section}.title`)), `${section} section`);
    }
    // The owner's late-cancellation / no-show policy line is shown as written.
    assert.ok(page.text.includes(t('bookingTerms.cancelling.lateOrNoShow')));
    // The late-arrival rule, with its minutes from the one constant.
    assert.ok(page.text.includes(t('bookingTerms.cancelling.lateArrival', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })));
    assert.ok(page.text.includes(t('bookingTerms.rights.body', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })), 'your rights agrees with it');
    assert.ok(page.text.includes('0113 496 0000'), 'the salon phone from settings');
    // The offer, discount-code and NHS/student-price terms, five items under their own anchor.
    for (const item of ['oneCode', 'noCombine', 'noCashValue', 'proof', 'withdraw'] as const) {
      assert.ok(page.text.includes(t(`bookingTerms.offers.${item}`)), `offers: ${item}`);
    }
    assert.ok(page.nodes.some((node) => node.type === 'section' && node.props.id === 'offers'), 'the offers section has id="offers"');
    assert.ok(page.text.indexOf(t('bookingTerms.changes.title')) < page.text.indexOf(t('bookingTerms.offers.title')));
    assert.ok(page.text.indexOf(t('bookingTerms.offers.title')) < page.text.indexOf(t('bookingTerms.patchTests.title')), 'between changes and patch tests');
    // The consultation credit rule follows the patch-test paragraph, with its months from the one constant.
    const credit = t('bookingTerms.patchTests.credit', { months: CONSULTATION_CREDIT_MONTHS });
    assert.ok(page.text.includes(credit), 'the consultation credit rule');
    assert.ok(page.text.indexOf(t('bookingTerms.patchTests.body', { hours: PATCH_TEST_MIN_LEAD_HOURS })) < page.text.indexOf(credit), 'after the patch-test paragraph');
    assert.equal(page.metadata.title, t('bookingTerms.meta.title'));

    const links = page.nodes.filter((node) => node.type === 'a').map((node) => node.props.href);
    assert.ok(links.includes('tel:+441134960000'), 'the phone is a tap-to-call link');
    for (const href of ['/appointments', '/contact', '/privacy']) assert.ok(links.includes(href), href);
    assert.ok(!page.nodes.some((node) => node.props.id === 'contact'), 'the site footer already uses id="contact"');
  });
}

test('each language is canonical to itself, with hreflang alternates', async () => {
  const en = (await termsPage('en-GB')).metadata.alternates;
  const zh = (await termsPage('zh-HK')).metadata.alternates;
  assert.equal(en?.canonical, '/booking-terms');
  assert.equal(zh?.canonical, '/zh-hk/booking-terms');
  assert.deepEqual(zh?.languages, { 'en-GB': '/booking-terms', 'zh-HK': '/zh-hk/booking-terms', 'x-default': '/booking-terms' });
});

test('the page is served from the ISR cache, never rendered per request', () => {
  const page = loadPage('en-GB');
  assert.equal(typeof page.revalidate, 'number');
  assert.ok(page.revalidate >= 3600);
  assert.ok(!('dynamic' in page), 'no force-dynamic: crawlers must not reach Neon through this page');
});

test('the periods the terms state are the ones the code enforces', async () => {
  const en = (await termsPage('en-GB')).text;
  assert.ok(en.includes('Last updated: 16 October 2026'));
  assert.ok(en.includes(`at least ${MIN_BOOKING_NOTICE_MINUTES / 60} hours’ notice`));
  assert.ok(en.includes(`at least ${PATCH_TEST_MIN_LEAD_HOURS} hours before your colour appointment`));
  assert.ok(en.includes('up to 24 hours before your appointment'));
  assert.ok(en.includes('A hold lasts up to 7 days'));
  assert.ok(en.includes(`if you go ahead within ${CONSULTATION_CREDIT_MONTHS} months, we take it off the treatment’s price, once. It isn’t refunded if you decide not to go ahead or miss the consultation.`));

  const zh = (await termsPage('zh-HK')).text;
  assert.ok(zh.includes(`最少提前 ${MIN_BOOKING_NOTICE_MINUTES / 60} 小時`));
  assert.ok(zh.includes(`最少 ${PATCH_TEST_MIN_LEAD_HOURS} 小時前`));
  assert.ok(zh.includes('最長 7 日'));
  assert.ok(zh.includes(`如你在 ${CONSULTATION_CREDIT_MONTHS} 個月內進行療程，本店會在療程價錢中扣除一次。`));
});

test('the offer terms say what they say, in both languages', async () => {
  const en = (await termsPage('en-GB')).text;
  assert.ok(en.includes('Offers, discount codes and NHS or student prices'));
  for (const sentence of [
    'One discount code per booking.',
    'A discount code can’t be combined with NHS or student prices or with another offer.',
    'Discount codes have no cash value and apply to the listed price.',
    'NHS and student prices, and some offers, need proof of eligibility at your appointment, such as a valid NHS staff ID or student card. Without it, the standard price applies.',
    'We may change or withdraw an offer; a booking already confirmed keeps the price it was confirmed at, as long as any proof of eligibility it needs is shown at your appointment.',
  ]) assert.ok(en.includes(sentence), sentence);

  const zh = (await termsPage('zh-HK')).text;
  assert.ok(zh.includes('優惠、優惠碼及 NHS 或學生價'));
  for (const sentence of ['每次預約只可使用一個優惠碼。', '優惠碼沒有現金價值', '本店可更改或撤回優惠；已確認的預約會維持確認時的價錢，惟如需資格證明，須於到店時出示。']) assert.ok(zh.includes(sentence), sentence);
});

test('the terms state the customer’s rights as the site applies them, and promise nothing it cannot do', async () => {
  const en = (await termsPage('en-GB')).text;
  assert.ok(en.includes('Your rights'));
  assert.ok(en.includes('You can cancel a confirmed booking online up to 24 hours before your appointment for a full refund of your deposit, or contact us at any time before your appointment.'));
  assert.ok(en.includes('If you miss your appointment, or are more than 15 minutes late without letting us know, we keep your deposit; if you cancel late, we may keep it. We never keep more than the deposit.'));
  assert.ok(en.includes('Your statutory rights are not affected.'));
  // No claim about cooling-off exemptions (owner's legal advice first), and no
  // partial keep: staff can only refund a whole deposit or keep all of it.
  assert.doesNotMatch(en, /\bcooling|\bexempt|\bhalf\b/i);
  // An unconfirmed request does not go ahead; its hold goes when declined, after its time, or at expiry.
  assert.ok(en.includes('A request we haven’t confirmed doesn’t go ahead, and its hold is released: when we decline it, once its appointment time has passed, or when the hold expires.'));
  assert.doesNotMatch(en, /lapses if we haven’t confirmed it before your appointment time/);

  const zh = (await termsPage('zh-HK')).text;
  assert.ok(zh.includes('你的權利') && zh.includes('你的法定權利不受影響。'));
  // Owner decision 2026-10-16: a no-show's deposit is kept; a late cancellation "may" be.
  assert.ok(zh.includes('如你沒有出席預約，本店會保留你的訂金。'), 'a missed appointment, as in English');
  assert.ok(zh.includes('如你在預約前 24 小時內取消，本店可能會保留你的訂金。'));
  assert.ok(en.includes('If you don’t come to your appointment, we keep your deposit.'));
  // Owner decision 2026-10-16 (late arrival): more than 15 minutes late without notice is treated as a missed appointment.
  assert.ok(en.includes('If you are more than 15 minutes late and haven’t let us know, we cancel your appointment so that the time can go to another client, and we keep your deposit, as for a missed appointment.'));
  assert.ok(zh.includes('如你遲到超過 15 分鐘而沒有通知本店，本店會取消你的預約，把時段讓給其他客人，並按缺席處理，不退還訂金。如你預計會遲到，請致電本店。'));
  assert.ok(zh.includes('如你缺席預約，或遲到超過 15 分鐘而沒有通知本店，本店會保留訂金；如你臨時取消，本店可能會保留訂金。'));
  assert.ok(zh.includes('本店未確認的申請不會生效'));
});

test('the footer links the booking terms next to the privacy policy', async () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const { Footer } = loadServerModule<typeof import('../../components/layout/Layout')>('src/components/layout/Layout.tsx', {
      '@/i18n/server': i18n(locale),
      '@/i18n/link': link,
      '@/app/services/site-settings-service': { getSiteSettings: async () => ({ phone: '0113 496 0000' }) },
      '@/app/services/offers-service': { hasActiveOffers: async () => false },
      '@/components/layout/SocialLinks': () => null,
    });
    const anchors = elements(render(await Footer())).filter((node) => node.type === 'a');
    const hrefs = anchors.map((node) => node.props.href);
    const terms = hrefs.indexOf('/booking-terms');
    assert.ok(terms > 0, `${locale}: the footer links /booking-terms`);
    assert.equal(hrefs[terms - 1], '/privacy', `${locale}: right after the privacy link`);
    assert.equal(text(anchors[terms]), translator(locale, 'common')('footer.bookingTerms'));
  }
});
