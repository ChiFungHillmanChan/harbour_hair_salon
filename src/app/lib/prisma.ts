import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Helper to get the correct database URL
function getDatabaseUrl() {
  // 1. Always prefer DATABASE_URL from environment if set
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // 2. In development, use local SQLite at root
  if (process.env.NODE_ENV !== 'production') {
    console.log('Development mode detected: Using local SQLite database');
    const dbPath = path.join(process.cwd(), 'dev.db');
    return `file:${dbPath}`;
  }

  // 3. Fallback manual load (rarely needed)
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envFile = fs.readFileSync(envPath, 'utf8');
      const match = envFile.match(/DATABASE_URL=["']?([^"'\n]+)["']?/);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (e) {
    console.error('Failed to load .env manually:', e);
  }
  
  // 4. Final fallback to dev.db
  return `file:${path.join(process.cwd(), 'dev.db')}`;
}

const dbUrl = getDatabaseUrl();

console.log('----------------------------------------');
console.log('PRISMA INIT');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Using Database URL:', dbUrl);
console.log('----------------------------------------');

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
