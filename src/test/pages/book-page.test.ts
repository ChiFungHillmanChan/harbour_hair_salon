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

function loadPage(options: { enabled: boolean; locale?: Locale; stylistTranslations?: Record<string, string> }) {
  const locale = options.locale ?? 'en-GB';
  const stylists = [
    { id: 'ivan', name: 'Ivan', role: 'Senior Stylist', imageUrl: null },
    { id: 'lox', name: 'Lox', role: 'Stylist', imageUrl: null },
  ];
  return loadServerModule<typeof import('../../app/[locale]/book/page')>('src/app/[locale]/book/page.tsx', {
    '@/app/lib/prisma': {
      stylist: { findMany: async () => stylists },
      user: { findUnique: async () => ({ email: 'customer@example.test', emailVerifiedAt: new Date(), oauthAccounts: [] }) },
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

test('open: the wizard gets the same contact details and the closed copy, for when booking closes mid-way', async () => {
  const tree = await loadPage({ enabled: true }).default();
  const [wizard] = find(tree, Wizard);
  assert.deepEqual(wizard.props.closedContact, CONTACT);
  const [messages] = find(tree, Messages);
  assert.ok((messages.props.sections as { booking: string[] }).booking.includes('closed'));
});
