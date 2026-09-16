import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';

test('importing Prisma needs no runtime configuration and methods keep their receiver', () => {
  const globalState = globalThis as typeof globalThis & { prisma?: unknown };
  const original = globalState.prisma;
  const previousPg = process.env.POSTGRES_URL;
  const previousDb = process.env.DATABASE_URL;
  let created = 0;
  let suppliedUrl = '';
  class Client {
    readonly marker = 'bound-client';
    constructor(options: { datasources: { db: { url: string } } }) { created++; suppliedUrl = options.datasources.db.url; }
    $connect() { return this.marker; }
  }
  try {
    delete globalState.prisma;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    const { default: db } = loadServerModule<{ default: Client }>('src/app/lib/prisma.ts', { '@prisma/client': { PrismaClient: Client } });
    assert.equal(created, 0);
    process.env.POSTGRES_URL = 'postgresql://localhost/salon_test';
    assert.equal(db.$connect(), 'bound-client');
    assert.equal(db.$connect(), 'bound-client');
    assert.equal(created, 1);
    assert.match(suppliedUrl, /connection_limit=5/);
  } finally {
    globalState.prisma = original;
    if (previousPg === undefined) delete process.env.POSTGRES_URL; else process.env.POSTGRES_URL = previousPg;
    if (previousDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDb;
  }
});
