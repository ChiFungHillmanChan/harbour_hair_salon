import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getDatabaseUrl(): string {
  let url: string;
  if (process.env.POSTGRES_URL) url = process.env.POSTGRES_URL;
  else if (process.env.DATABASE_URL) url = process.env.DATABASE_URL;
  else throw new Error('No database URL configured. Set POSTGRES_URL or DATABASE_URL.');

  // Limit connection pool for serverless (Neon Hobby allows ~100 total)
  if (url.startsWith('postgres') && !url.includes('connection_limit')) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}connection_limit=5`;
  }

  return url;
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
