/**
 * Infrastructure-only bootstrap; inject credentials from the secret manager.
 * Required env: SALON_AUTH_MAINTENANCE=confirmed,
 * SALON_AUTH_MAINTENANCE_DATABASE_URL, SALON_MAINTENANCE_OPERATOR_ID,
 * SALON_BOOTSTRAP_ADMIN_NAME, SALON_BOOTSTRAP_ADMIN_EMAIL,
 * SALON_BOOTSTRAP_ADMIN_PASSWORD and SALON_BOOTSTRAP_TICKET.
 * Run: node --conditions=react-server --import tsx prisma/create-admin.ts
 * No command-line credentials. Existing sessions are revoked and existing MFA
 * is retained. A new administrator must enroll MFA during their first sign-in.
 */
import { PrismaClient } from '@prisma/client';
import { bootstrapAdminOffline, maintenanceDatabaseUrl } from '../src/app/lib/mfa-maintenance';

async function main() {
  if (process.argv.length > 2) throw new Error('Command-line credentials are no longer accepted');
  const db = new PrismaClient({ datasources: { db: { url: maintenanceDatabaseUrl(process.env) } } });
  try {
    await bootstrapAdminOffline(db, {
      name: process.env.SALON_BOOTSTRAP_ADMIN_NAME ?? '',
      email: process.env.SALON_BOOTSTRAP_ADMIN_EMAIL ?? '',
      password: process.env.SALON_BOOTSTRAP_ADMIN_PASSWORD ?? '',
      operatorId: process.env.SALON_MAINTENANCE_OPERATOR_ID ?? '',
      ticket: process.env.SALON_BOOTSTRAP_TICKET ?? '',
    });
    console.log('Administrator bootstrap recorded. Sign-in and MFA verification are required.');
  } finally { await db.$disconnect(); }
}

void main().catch(() => {
  console.error('Administrator bootstrap failed. Use the explicit maintenance target, approved operator/change reference and secret-manager environment values. No credentials were logged.');
  process.exitCode = 1;
});
