import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withServerlessPoolParams } from './prisma';

test('a bare Postgres URL gets the pool size and cold-start timeouts', () => {
  assert.equal(
    withServerlessPoolParams('postgresql://u:p@host/db?sslmode=require'),
    'postgresql://u:p@host/db?sslmode=require&connection_limit=5&connect_timeout=15&pool_timeout=20',
  );
  assert.equal(
    withServerlessPoolParams('postgres://u:p@host/db'),
    'postgres://u:p@host/db?connection_limit=5&connect_timeout=15&pool_timeout=20',
  );
});

test('values already present in the URL are kept as they are', () => {
  assert.equal(
    withServerlessPoolParams('postgresql://u:p@host/db?connect_timeout=30&connection_limit=1'),
    'postgresql://u:p@host/db?connect_timeout=30&connection_limit=1&pool_timeout=20',
  );
});

test('SQLite and SQL Server URLs are untouched', () => {
  assert.equal(withServerlessPoolParams('file:./dev.db'), 'file:./dev.db');
  assert.equal(withServerlessPoolParams('sqlserver://host;database=x'), 'sqlserver://host;database=x');
});
