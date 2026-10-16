import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

// My Bookings belongs to whoever proved the address. Staff attach phone
// bookings to the account that holds the customer's email, and anyone can
// register an address they do not own, so an unconfirmed account sees a
// "confirm your email" prompt — never the bookings (security review 2026-10-16).

function load(account: { email: string; emailVerifiedAt: Date | null; oauthAccounts: { provider: string }[] }) {
  const queries: string[] = [];
  const form = () => null;
  const page = loadServerModule<typeof import('../../app/[locale]/appointments/page')>('src/app/[locale]/appointments/page.tsx', {
    '@/components/admin/Pagination': { Pagination: () => null },
    '@/app/lib/prisma': {
      user: { findUnique: async () => account },
      appointment: { findMany: async () => { queries.push('appointment'); return []; } },
    },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1' }) },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true },
    '@/components/appointments/AppointmentCard': { AppointmentCard: () => null },
    '@/components/auth/VerifyEmailResendForm': { VerifyEmailResendForm: form },
    '@/i18n/ClientMessages': { ClientMessages: ({ children }: { children: unknown }) => children },
    '@/i18n/server': { getLocale: async () => 'en-GB', getT: async (namespace: Namespace) => translator('en-GB', namespace) },
  });
  return { page, queries, form };
}

function contains(node: unknown, predicate: (element: { type: unknown; props: Record<string, unknown> }) => boolean): boolean {
  if (Array.isArray(node)) return node.some((child) => contains(child, predicate));
  if (!node || typeof node !== 'object' || !('props' in node)) return false;
  const element = node as { type: unknown; props: Record<string, unknown> };
  return predicate(element) || contains(element.props.children, predicate);
}

test('an account that never confirmed its email is asked to, and no booking is read', async () => {
  const { page, queries, form } = load({ email: 'victim@example.com', emailVerifiedAt: null, oauthAccounts: [] });
  const tree = await page.default({});
  assert.deepEqual(queries, []);
  assert.ok(contains(tree, (element) => element.type === form && element.props.email === 'victim@example.com'));
  const t = translator('en-GB', 'auth');
  assert.ok(contains(tree, (element) => element.props.children === t('verifyEmail.manageTitle')));
});

test('a confirmed address, or a linked Google account, sees the bookings', async () => {
  for (const account of [
    { email: 'a@example.com', emailVerifiedAt: new Date('2026-01-01T00:00:00Z'), oauthAccounts: [] },
    { email: 'b@example.com', emailVerifiedAt: null, oauthAccounts: [{ provider: 'google' }] },
  ]) {
    const { page, queries, form } = load(account);
    const tree = await page.default({});
    assert.deepEqual(queries, ['appointment', 'appointment'], account.email);
    assert.ok(!contains(tree, (element) => element.type === form), account.email);
  }
});
