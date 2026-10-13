import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { loadServerModule } from '../../test/load-server-module';
import { fitsBcryptLimit } from '../lib/password';
import { translator } from '../../i18n/messages';

// Sign-in looks accounts up by `email.trim().toLowerCase()` (actions/auth.ts),
// so an admin account stored as typed ("Owner@Example.com") could never sign in.

function fixture(existingEmails: string[] = []) {
  const created: { email: string; name: string; role: string }[] = [];
  const tx = {
    user: {
      // A unique index compares bytes, exactly like PostgreSQL's.
      create: async ({ data }: { data: { email: string; name: string; role: string } }) => {
        if ([...existingEmails, ...created.map((row) => row.email)].includes(data.email)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', { code: 'P2002', clientVersion: 'test' });
        }
        created.push(data);
        return { id: `user-${created.length}` };
      },
    },
    auditEvent: { create: async () => ({ id: 'audit' }) },
  };
  const db = { ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  const actions = loadServerModule<typeof import('./admin')>('src/app/actions/admin.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'acting-admin', role: 'ADMIN' }) },
    '@/app/lib/password': { fitsBcryptLimit, hashPassword: async () => 'hash' },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined },
    'next/cache': { revalidatePath: () => undefined, updateTag: () => undefined },
    '@/app/actions/admin-services': {},
    '@/app/services/notification-outbox-service': {},
    '@/app/services/integration-readiness': {},
    '@/app/services/booking-service': {},
  });
  const create = (email: string) => {
    const form = new FormData();
    form.set('name', 'Salon Owner');
    form.set('email', email);
    form.set('password', 'a-strong-password');
    return actions.createAdminUser({}, form);
  };
  return { create, created };
}

test('an admin account is stored under the trimmed, lower-case address sign-in looks up', async () => {
  const f = fixture();
  assert.deepEqual(await f.create('  Owner@Example.COM '), { success: true });
  assert.deepEqual(f.created.map((row) => [row.email, row.role]), [['owner@example.com', 'ADMIN']]);
});

test('an address that differs from an existing account only in case is refused as taken', async () => {
  const f = fixture(['owner@example.com']);
  const taken = translator('en-GB', 'adminOps')('users.errors.EMAIL_TAKEN');
  assert.deepEqual(await f.create('OWNER@example.com'), { error: taken });
  assert.deepEqual(f.created, []);
});

test('a malformed address is still refused after trimming', async () => {
  const f = fixture();
  const invalid = translator('en-GB', 'adminOps')('users.errors.EMAIL_INVALID');
  assert.deepEqual(await f.create('  not an email  '), { error: invalid });
  assert.deepEqual(f.created, []);
});
