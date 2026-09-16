/**
 * OFFLINE PROCEDURE — inject secrets from the secret manager, never command args.
 * 1. Stop authentication traffic and take a restorable encrypted database backup.
 * 2. Set SALON_AUTH_MAINTENANCE=confirmed and an explicit
 *    SALON_AUTH_MAINTENANCE_DATABASE_URL. Set SALON_MFA_OLD_SESSION_SECRET and
 *    SALON_MFA_NEW_SESSION_SECRET; keep SESSION_SECRET unchanged until success.
 * 3. node --conditions=react-server --import tsx prisma/rotate-mfa-key.ts
 * 4. On success, update every deployment's SESSION_SECRET to the new value,
 *    redeploy, and test an administrator login before reopening traffic.
 * If interrupted: keep traffic offline and rerun with the same old/new keys.
 * Do not restore just the old application key after rows have been rotated.
 */
import { PrismaClient } from '@prisma/client';
import { maintenanceDatabaseUrl, rotateMfaKeys } from '../src/app/lib/mfa-maintenance';

async function main() {
  const url = maintenanceDatabaseUrl(process.env);
  const oldKey = process.env.SALON_MFA_OLD_SESSION_SECRET ?? '';
  const newKey = process.env.SALON_MFA_NEW_SESSION_SECRET ?? '';
  const db = new PrismaClient({ datasources: { db: { url } } });
  try { console.log('MFA key rotation completed:', await rotateMfaKeys(db, oldKey, newKey)); }
  finally { await db.$disconnect(); }
}

void main().catch(() => {
  console.error('MFA key rotation failed. Keep authentication offline; verify the maintenance configuration and resume with the same old/new keys. No secrets were logged.');
  process.exitCode = 1;
});
