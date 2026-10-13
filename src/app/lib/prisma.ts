import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Serverless defaults for a Postgres URL; values already in the URL win.
 * - connection_limit=5: a small pool per function instance (Neon allows ~100 in total).
 * - connect_timeout=15: Neon suspends after 5 idle minutes and a cold start can
 *   outlast Prisma's 5 s default (P1001 errors seen in September 2026).
 * - pool_timeout=20: wait a little longer for a pooled connection during that start.
 */
export function withServerlessPoolParams(url: string): string {
  if (!url.startsWith('postgres')) return url;
  const defaults = [['connection_limit', '5'], ['connect_timeout', '15'], ['pool_timeout', '20']] as const;
  let result = url;
  for (const [key, value] of defaults) {
    if (new RegExp(`[?&]${key}=`).test(result)) continue;
    result = `${result}${result.includes('?') ? '&' : '?'}${key}=${value}`;
  }
  return result;
}

function getDatabaseUrl(): string {
  let url: string;
  if (process.env.POSTGRES_URL) url = process.env.POSTGRES_URL;
  else if (process.env.DATABASE_URL) url = process.env.DATABASE_URL;
  else throw new Error('No database URL configured. Set POSTGRES_URL or DATABASE_URL.');
  return withServerlessPoolParams(url);
}

/** Raw SQL differences follow the same runtime URL used by the generated client. */
export function getDatabaseProvider(): 'postgresql' | 'sqlite' | 'sqlserver' {
  const url = getDatabaseUrl();
  if (url.startsWith('postgres')) return 'postgresql';
  if (url.startsWith('file:')) return 'sqlite';
  if (url.startsWith('sqlserver:')) return 'sqlserver';
  throw new Error('Unsupported database provider');
}

// Resolve runtime configuration only when a query is made. Importing a disabled
// cron handler (or a build-time module) must not need database credentials.
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });
  }
  return globalForPrisma.prisma;
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export default prisma;
