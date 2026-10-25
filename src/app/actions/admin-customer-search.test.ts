import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '@/test/load-server-module';
import { matchesWhere } from '@/test/prisma-where';
import { placeholderEmailFor } from '@/app/lib/walk-in-customer';
import { ERASED_CUSTOMER_NAME, erasedEmailFor } from '@/app/lib/customer-erasure';

type UserRow = { id: string; name: string; email: string; phone: string | null; preferredLocale: string | null; role: string; createdAt: Date };
type Where = Record<string, unknown>;

function searchWith(rows: UserRow[], role = 'ADMIN', provider: 'postgresql' | 'sqlite' = 'postgresql') {
  const queries: { where: Where; take?: number }[] = [];
  const db = {
    user: {
      findMany: async (args: { where: Where; orderBy?: { createdAt: 'desc' }; take?: number }) => {
        queries.push(args);
        const matching = rows.filter((row) => matchesWhere(row, args.where));
        if (args.orderBy?.createdAt === 'desc') matching.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return matching.slice(0, args.take ?? matching.length);
      },
    },
  };
  const schedule = loadServerModule<typeof import('./admin-schedule')>('src/app/actions/admin-schedule.ts', {
    '@/app/lib/prisma': { __esModule: true, default: db, getDatabaseProvider: () => provider },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role }) },
    '@/app/services/booking-service': {},
    '@/app/services/notification-outbox-service': {},
    '@/app/services/stylist-ical-cache': {},
    'next/cache': { revalidatePath: () => undefined },
    'next/server': { after: () => undefined },
  });
  return { search: schedule.searchAdminCustomers, queries };
}

const customer = (index: number, overrides: Partial<UserRow> = {}): UserRow => ({
  id: `user-${index}`,
  name: `Customer ${index}`,
  email: `customer${index}@example.test`,
  phone: null,
  preferredLocale: null,
  role: 'USER',
  createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000),
  ...overrides,
});

test('staff can still find a customer who registered before the newest 2,000', async () => {
  const oldest = customer(0, { name: 'Margaret Holloway', phone: '07700900123' });
  const rows = [oldest, ...Array.from({ length: 2_500 }, (_, index) => customer(index + 1))];
  const { search } = searchWith(rows);

  assert.deepEqual((await search('holloway')).map((row) => row.id), ['user-0'], 'found by name');
  assert.deepEqual((await search('0900123')).map((row) => row.id), ['user-0'], 'found by phone');
});

test('the customer search ignores case on PostgreSQL', async () => {
  const { search } = searchWith([customer(1, { name: 'Mei Ling', email: 'Mei.Ling@Example.test' })]);

  assert.deepEqual((await search('MEI')).map((row) => row.id), ['user-1']);
  assert.deepEqual((await search('mei.ling@example')).map((row) => row.id), ['user-1']);
});

test('a walk-in placeholder address is never what a search matches', async () => {
  const walkIn = customer(1, { name: 'Ada', email: placeholderEmailFor('ada-123') });
  const { search } = searchWith([walkIn]);

  assert.deepEqual(await search('walk-in'), [], 'the synthetic domain is not a match');
  assert.deepEqual((await search('ada')).map((row) => row.id), ['user-1'], 'the name still is');
});

test('an erased customer is never offered, even by the erased placeholder name', async () => {
  const gone = customer(1, { name: ERASED_CUSTOMER_NAME, email: erasedEmailFor('user-1') });
  const { search } = searchWith([gone, customer(2, { name: 'Erasmus Lee' })]);

  assert.deepEqual((await search('eras')).map((row) => row.id), ['user-2']);
});

test('the database returns only the handful of rows the dialog shows', async () => {
  const { search, queries } = searchWith(Array.from({ length: 50 }, (_, index) => customer(index)));

  const found = await search('customer');
  assert.deepEqual(found.map((row) => row.id), ['user-49', 'user-48', 'user-47', 'user-46', 'user-45', 'user-44', 'user-43', 'user-42'], 'the newest eight');
  assert.ok(queries.every((query) => query.take !== undefined && query.take <= 8), 'no bulk read of the customer table');
});

test('a signed-in customer gets nothing and reads nothing', async () => {
  // Every Server Action is a public endpoint: without the admin check, any
  // account could page through customers' names, emails and phones.
  const { search, queries } = searchWith([customer(1)], 'USER');

  assert.deepEqual(await search('customer'), []);
  assert.equal(queries.length, 0);
});

test('administrators are never offered as customers', async () => {
  const { search } = searchWith([customer(1, { name: 'Owner Admin', role: 'ADMIN' }), customer(2, { name: 'Owner Customer' })]);

  assert.deepEqual((await search('owner')).map((row) => row.id), ['user-2']);
});

test('the dev SQLite schema gets no `mode`, which only Postgres accepts (its LIKE already ignores case)', async () => {
  const { search, queries } = searchWith([customer(1, { name: 'Mei Ling' })], 'ADMIN', 'sqlite');

  assert.deepEqual((await search('Mei')).map((row) => row.id), ['user-1']);
  assert.doesNotMatch(JSON.stringify(queries[0].where), /"mode"/);
});

