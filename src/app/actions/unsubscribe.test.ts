import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '@/i18n/messages';
import { createUnsubscribeToken } from '@/app/lib/unsubscribe-token';

process.env.SESSION_SECRET = 'unsubscribe-action-test-session-secret-32';
process.env.RESEND_API_KEY = 're_fixture_not_a_key';
process.env.RESEND_AUDIENCE_ID = 'audience-fixture';

type Contact = { unsubscribed: boolean } | 'missing';

function setup(options: { contact?: Contact; allow?: (prefix: string, key: string) => boolean } = {}) {
  const updates: unknown[] = [];
  const lookups: unknown[] = [];
  const sent: string[] = [];
  const limiterKeys: string[] = [];
  const contact = options.contact ?? 'missing';
  class Resend {
    contacts = {
      get: async (query: unknown) => {
        lookups.push(query);
        return contact === 'missing'
          ? { data: null, error: { message: 'Contact not found', statusCode: 404, name: 'not_found' } }
          : { data: { id: 'contact-1', email: 'x', unsubscribed: contact.unsubscribed }, error: null };
      },
      update: async (payload: unknown) => {
        updates.push(payload);
        return contact === 'missing'
          ? { data: null, error: { message: 'Contact not found', statusCode: 404, name: 'not_found' } }
          : { data: { id: 'contact-1', object: 'contact' }, error: null };
      },
    };
  }
  const actions = loadServerModule<typeof import('./unsubscribe')>('src/app/actions/unsubscribe.ts', {
    'next/headers': { headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }) },
    resend: { Resend },
    '@/app/lib/rate-limit': {
      createRateLimiter: ({ prefix }: { prefix: string }) => ({
        backend: () => 'memory',
        check: async (key: string) => { limiterKeys.push(`${prefix}|${key}`); return options.allow?.(prefix, key) ?? true; },
      }),
    },
    '@/app/services/email-service': {
      sendMarketingUnsubscribeConfirmation: async (email: string) => { sent.push(email); },
    },
    '@/i18n/request': { getActionT: async (namespace: 'legal') => translator('en-GB', namespace) },
  });
  return { actions, updates, lookups, sent, limiterKeys };
}

const t = translator('en-GB', 'legal');
const LINK_SENT = { status: 'success', message: t('unsubscribe.results.LINK_SENT') };

function emailForm(email: string) {
  const form = new FormData();
  form.set('email', email);
  return form;
}

function tokenForm(token: string) {
  const form = new FormData();
  form.set('token', token);
  return form;
}

test('the email form sends one confirmation link to a subscribed address and never changes the list', async () => {
  const f = setup({ contact: { unsubscribed: false } });
  const result = await f.actions.unsubscribeFromMarketing({ status: 'idle' }, emailForm(' Customer@Example.com '));
  assert.deepEqual(result, LINK_SENT);
  assert.deepEqual(f.sent, ['customer@example.com']);
  assert.deepEqual(f.lookups, [{ email: 'customer@example.com', audienceId: 'audience-fixture' }]);
  assert.equal(f.updates.length, 0, 'typing an address in must not unsubscribe it');
});

for (const [label, contact] of [['an unknown', 'missing'], ['an already unsubscribed', { unsubscribed: true }]] as const) {
  test(`${label} address gets the same answer and no email`, async () => {
    const f = setup({ contact });
    const result = await f.actions.unsubscribeFromMarketing({ status: 'idle' }, emailForm('someone@example.com'));
    assert.deepEqual(result, LINK_SENT, 'the answer must not reveal whether the address is on the list');
    assert.deepEqual(f.sent, []);
    assert.equal(f.updates.length, 0);
  });
}

test('the per-address limit sends nothing, asks the provider nothing, and answers the same', async () => {
  const f = setup({ contact: { unsubscribed: false }, allow: (prefix) => prefix !== 'rl:unsub-email' });
  const result = await f.actions.unsubscribeFromMarketing({ status: 'idle' }, emailForm('customer@example.com'));
  assert.deepEqual(result, LINK_SENT);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.lookups, []);
  const emailKey = f.limiterKeys.find((key) => key.startsWith('rl:unsub-email|'));
  assert.ok(emailKey);
  assert.doesNotMatch(emailKey, /@/, 'the address itself is never a rate-limit key');
});

test('the per-IP limit refuses before any lookup', async () => {
  const f = setup({ contact: { unsubscribed: false }, allow: (prefix) => prefix !== 'rl:unsub' });
  const result = await f.actions.unsubscribeFromMarketing({ status: 'idle' }, emailForm('customer@example.com'));
  assert.deepEqual(result, { status: 'error', message: t('unsubscribe.results.RATE_LIMITED') });
  assert.deepEqual(f.lookups, []);
  assert.deepEqual(f.sent, []);
});

test('a valid emailed link unsubscribes exactly that address once', async () => {
  const f = setup({ contact: { unsubscribed: false } });
  const token = await createUnsubscribeToken('Customer@Example.com');
  const result = await f.actions.confirmUnsubscribe({ status: 'idle' }, tokenForm(token));
  assert.deepEqual(result, { status: 'success', message: t('unsubscribe.results.SUCCESS') });
  assert.deepEqual(f.updates, [{ email: 'customer@example.com', audienceId: 'audience-fixture', unsubscribed: true }]);
  assert.deepEqual(f.sent, []);
});

test('a link for an address no longer on the list reports success without creating a contact', async () => {
  const f = setup({ contact: 'missing' });
  const result = await f.actions.confirmUnsubscribe({ status: 'idle' }, tokenForm(await createUnsubscribeToken('gone@example.com')));
  assert.deepEqual(result, { status: 'success', message: t('unsubscribe.results.SUCCESS') });
  assert.equal(f.updates.length, 1);
});

for (const [label, token] of [['a forged', 'eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6InZAZXhhbXBsZS5jb20ifQ.c2ln'], ['an empty', ''], ['a missing', null]] as const) {
  test(`${label} link changes nothing`, async () => {
    const f = setup({ contact: { unsubscribed: false } });
    const form = new FormData();
    if (token !== null) form.set('token', token);
    const result = await f.actions.confirmUnsubscribe({ status: 'idle' }, form);
    assert.deepEqual(result, { status: 'error', message: t('unsubscribe.results.INVALID_LINK'), linkInvalid: true });
    assert.equal(f.updates.length, 0);
  });
}

test('an expired link changes nothing', async () => {
  const f = setup({ contact: { unsubscribed: false } });
  const token = await createUnsubscribeToken('customer@example.com', new Date(Date.now() - 31 * 86_400_000));
  const result = await f.actions.confirmUnsubscribe({ status: 'idle' }, tokenForm(token));
  assert.equal(result.status, 'error');
  assert.equal(f.updates.length, 0);
});
