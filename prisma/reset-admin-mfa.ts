/**
 * BREAK-GLASS ONLY: first verify the account owner's identity outside the app
 * and record approval/evidence in an incident ticket. Use an infrastructure
 * operator account with database access; this is deliberately not a web action.
 * Inject SALON_AUTH_MAINTENANCE=confirmed, SALON_AUTH_MAINTENANCE_DATABASE_URL,
 * SALON_MFA_RESET_USER_ID, SALON_MFA_RESET_OPERATOR_ID and SALON_MFA_RESET_TICKET.
 * Run: node --conditions=react-server --import tsx prisma/reset-admin-mfa.ts
 * The action revokes existing sessions and forces first-factor login followed
 * by new authenticator enrollment. It does not change a password or sign in.
 * Review the AUTH.MFA_RESET audit event and store the new recovery codes safely.
 */
import { PrismaClient } from '@prisma/client';
import { maintenanceDatabaseUrl, resetAdminMfaOffline } from '../src/app/lib/mfa-maintenance';

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: maintenanceDatabaseUrl(process.env) } } });
  try {
    await resetAdminMfaOffline(db, process.env.SALON_MFA_RESET_USER_ID ?? '', process.env.SALON_MFA_RESET_OPERATOR_ID ?? '', process.env.SALON_MFA_RESET_TICKET ?? '');
    console.log('Administrator MFA reset recorded. First-factor login and authenticator enrollment are required.');
  } finally { await db.$disconnect(); }
}

void main().catch(() => { console.error('Administrator MFA reset failed. Check the explicit maintenance configuration and approved operator/target details.'); process.exitCode = 1; });
