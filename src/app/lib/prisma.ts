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

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: { url: getDatabaseUrl() },
  },
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
