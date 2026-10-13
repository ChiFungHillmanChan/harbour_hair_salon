import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

type Element = { type: unknown; props: Record<string, unknown> };
function find(node: unknown, type: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, type));
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [...(element.type === type ? [element] : []), ...find(element.props.children, type)];
}

const Wizard = () => null;
const ClosedNotice = () => null;
const Messages = ({ children }: { children: unknown }) => children;
const SETTINGS = { phone: '0113 496 0000', freshaUrl: 'https://www.fresha.com/a/harbour-hair', treatwellUrl: '', booksyUrl: '' };
const CONTACT = { phone: '0113 496 0000', marketplaces: [{ name: 'Fresha', url: 'https://www.fresha.com/a/harbour-hair' }] };

/** A complete Square sandbox configuration, secrets included (lib/square-config.ts). */
const SQUARE_SANDBOX = {
  SQUARE_PAYMENTS_ENABLED: 'true', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_ACCESS_TOKEN: 'secret-access-token',
  SQUARE_APPLICATION_ID: 'sandbox-sq0idb-public-app', SQUARE_LOCATION_ID: 'public-location',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'secret-signature-key', SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://example.test/api/webhooks/square',
};
const lock = loadServerModule<typeof import('../../app/lib/online-booking-lock')>('src/app/lib/online-booking-lock.ts', {});

function loadPage(options: { enabled: boolean; locale?: Locale; stylistTranslations?: Record<string, string>; squareEnv?: Record<string, string>; accountName?: string | null }) {
  const locale = options.locale ?? 'en-GB';
  const stylists = [
    { id: 'ivan', name: 'Ivan', role: 'Senior Stylist', imageUrl: null },
    { id: 'lox', name: 'Lox', role: 'Stylist', imageUrl: null },
  ];
  return loadServerModule<typeof import('../../app/[locale]/book/page')>('src/app/[locale]/book/page.tsx', {
    // The real rule, over the environment the test chose instead of process.env.
    '@/app/lib/online-booking-lock': { publicSquareConfig: () => lock.publicSquareConfig(options.squareEnv ?? {}) },
    '@/app/lib/prisma': {
      stylist: { findMany: async () => stylists },
      user: { findUnique: async () => ({ email: 'customer@example.test', name: options.accountName === undefined ? 'Ada Lovelace' : options.accountName, emailVerifiedAt: new Date(), oauthAccounts: [] }) },
      contentTranslation: {
        findMany: async () => Object.entries(options.stylistTranslations ?? {})
          .map(([entityId, role]) => ({ entityId, fieldsJson: JSON.stringify({ role }) })),
      },
    },
    'next/image': { __esModule: true, default: () => null },
    'next/navigation': { redirect: (to: string) => { throw new Error(`redirected to ${to}`); } },
    '@/components/booking/BookingWizard': { BookingWizard: Wizard },
    '@/components/booking/BookingClosedNotice': { BookingClosedNotice: ClosedNotice },
    '@/components/auth/VerifyEmailResendForm': { VerifyEmailResendForm: () => null },
    '@/app/services/review-service': { getAggregateRating: async () => ({ count: 0, average: 0 }) },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => options.enabled },
    '@/app/lib/session': { getSession: async () => ({ userId: 'user-1' }) },
    '@/app/services/site-settings-service': { getSiteSettings: async () => SETTINGS },
    '@/app/services/pricing/public-catalog': { getPublicCatalog: async () => ({ services: [], offerings: [], categories: [] }) },
    '@/i18n/server': { getLocale: async () => locale, getT: async (namespace: Namespace) => translator(locale, namespace) },
    '@/i18n/ClientMessages': { ClientMessages: Messages },
  });
}

test('closed: /book shows the shared closed notice with the salon phone and live marketplaces', async () => {
  const tree = await loadPage({ enabled: false }).default();
  const [notice] = find(tree, ClosedNotice);
  assert.ok(notice, 'the closed copy comes from BookingClosedNotice');
  assert.equal(notice.props.phone, CONTACT.phone);
  assert.deepEqual(notice.props.marketplaces, CONTACT.marketplaces);
  assert.equal(typeof notice.props.t, 'function');
  assert.deepEqual(find(tree, Wizard), []);
});

type WizardStylist = { id: string; role: string; translated: boolean };
const roles = (stylists: unknown) => (stylists as WizardStylist[]).map(({ id, role, translated }) => ({ id, role, translated }));

test('on /zh-hk the wizard is told which stylist roles fell back to English (marked lang="en")', async () => {
  const tree = await loadPage({ enabled: true, locale: 'zh-HK', stylistTranslations: { ivan: '資深髮型師' } }).default();
  assert.deepEqual(roles(find(tree, Wizard)[0].props.stylists), [
    { id: 'ivan', role: '資深髮型師', translated: true },
    { id: 'lox', role: 'Stylist', translated: false },
  ]);
});

test('in English no role is a fallback', async () => {
  const tree = await loadPage({ enabled: true }).default();
  assert.ok(roles(find(tree, Wizard)[0].props.stylists).every((stylist) => stylist.translated));
});

test('open: the wizard gets the same contact details and the closed copy, for when booking closes mid-way', async () => {
  const tree = await loadPage({ enabled: true }).default();
  const [wizard] = find(tree, Wizard);
  assert.deepEqual(wizard.props.closedContact, CONTACT);
  const [messages] = find(tree, Messages);
  assert.ok((messages.props.sections as { booking: string[] }).booking.includes('closed'));
});

test('card deposits: the wizard gets only Square’s public values and the account holder, never a secret', async () => {
  const tree = await loadPage({ enabled: true, squareEnv: SQUARE_SANDBOX }).default();
  const [wizard] = find(tree, Wizard);
  assert.deepEqual(wizard.props.payment, {
    square: { applicationId: 'sandbox-sq0idb-public-app', locationId: 'public-location', environment: 'sandbox' },
    payer: { name: 'Ada Lovelace', email: 'customer@example.test' },
  });
  const props = JSON.stringify(wizard.props);
  for (const secret of ['secret-access-token', 'secret-signature-key', 'webhooks/square']) assert.ok(!props.includes(secret), secret);
  const [messages] = find(tree, Messages);
  assert.ok((messages.props.sections as { booking: string[] }).booking.includes('deposit'), 'the card form copy reaches the browser');
});

test('card deposits: no usable Square configuration reaches the wizard as none', async (t) => {
  t.mock.method(console, 'error', () => {});
  const production = { ...SQUARE_SANDBOX, SQUARE_ENVIRONMENT: 'production', SQUARE_APPLICATION_ID: 'sq0idp-public-app' };
  for (const squareEnv of [
    {}, { ...SQUARE_SANDBOX, SQUARE_PAYMENTS_ENABLED: 'false' }, { ...SQUARE_SANDBOX, NODE_ENV: 'production', VERCEL_ENV: 'production' },
    // Production credentials on a preview: never a live card form there.
    { ...production, NODE_ENV: 'production', VERCEL_ENV: 'preview' },
  ]) {
    const tree = await loadPage({ enabled: true, squareEnv, accountName: null }).default();
    assert.deepEqual(find(tree, Wizard)[0].props.payment, { square: null, payer: { name: null, email: 'customer@example.test' } }, JSON.stringify(squareEnv));
  }
});
