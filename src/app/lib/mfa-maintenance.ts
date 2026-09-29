import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { decryptMfaSecret, encryptMfaSecret } from '@/app/lib/mfa-crypto';
import { appendAuditEvent } from '@/app/lib/audit';
import { hashPassword } from '@/app/lib/password';

/** Offline only. Never accept this target or these secrets from an HTTP request. */
export function maintenanceDatabaseUrl(env: Record<string, string | undefined>): string {
  if (env.SALON_AUTH_MAINTENANCE !== 'confirmed') throw new Error('Explicit authentication maintenance confirmation is required');
  const target = env.SALON_AUTH_MAINTENANCE_DATABASE_URL;
  if (!target || !/^postgres(?:ql)?:\/\//.test(target)) throw new Error('An explicit PostgreSQL maintenance target is required');
  return target;
}

/** Bounded batches and conditional writes allow an interrupted rotation to resume. */
export async function rotateMfaKeys(db: PrismaClient, oldKey: string, newKey: string) {
  if (oldKey.length < 32 || newKey.length < 32 || oldKey === newKey) throw new Error('Distinct old/new keys of at least 32 characters are required');
  let cursor: string | undefined;
  let rotated = 0;
  let alreadyRotated = 0;
  for (;;) {
    const users = await db.user.findMany({
      where: { OR: [{ mfaSecretEncrypted: { not: null } }, { mfaPendingSecretEncrypted: { not: null } }] },
      select: { id: true, sessionVersion: true, mfaSecretEncrypted: true, mfaPendingSecretEncrypted: true },
      orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (users.length === 0) break;
    for (const user of users) {
      const transform = (encrypted: string | null) => {
        if (encrypted === null) return null;
        try { return encryptMfaSecret(decryptMfaSecret(encrypted, oldKey), newKey); }
        catch {
          // A successful new-key decode proves this row already completed on a
          // previous run. If neither key works, abort without corrupting it.
          decryptMfaSecret(encrypted, newKey);
          return encrypted;
        }
      };
      const active = transform(user.mfaSecretEncrypted);
      const pending = transform(user.mfaPendingSecretEncrypted);
      if (active === user.mfaSecretEncrypted && pending === user.mfaPendingSecretEncrypted) { alreadyRotated++; continue; }
      await db.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({
          where: { id: user.id, sessionVersion: user.sessionVersion, mfaSecretEncrypted: user.mfaSecretEncrypted, mfaPendingSecretEncrypted: user.mfaPendingSecretEncrypted },
          data: { mfaSecretEncrypted: active, mfaPendingSecretEncrypted: pending, sessionVersion: { increment: 1 } },
        });
        if (changed.count !== 1) throw new Error('Account changed during key rotation; keep authentication offline and retry');
        await appendAuditEvent({ action: 'AUTH.MFA_KEY_ROTATED', targetType: 'User', targetId: user.id }, tx);
      });
      rotated++;
    }
    cursor = users[users.length - 1].id;
  }
  return { rotated, alreadyRotated };
}

/** Infrastructure-only break-glass recovery after the operator verifies identity. */
export async function resetAdminMfaOffline(db: PrismaClient, targetId: string, operatorId: string, ticket: string) {
  if (![targetId, operatorId, ticket].every((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new Error('Target, administrator operator and incident reference are required');
  await db.$transaction(async (tx) => {
    const operator = await tx.user.findUnique({ where: { id: operatorId }, select: { role: true } });
    if (operator?.role !== 'ADMIN') throw new Error('The recovery operator must be a recorded administrator');
    const changed = await tx.user.updateMany({
      where: { id: targetId, role: 'ADMIN' },
      data: {
        mfaSecretEncrypted: null, mfaEnabledAt: null, mfaLastUsedStep: null,
        mfaRecoveryCodesJson: '[]', mfaPendingSecretEncrypted: null, mfaPendingExpiresAt: null,
        sessionVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new Error('The target administrator does not exist');
    await appendAuditEvent({ actorUserId: operatorId, action: 'AUTH.MFA_RESET', targetType: 'User', targetId, metadata: { ticket } }, tx);
  });
}

/** Infrastructure bootstrap, including the first admin before any app actor exists. */
export async function bootstrapAdminOffline(db: PrismaClient, input: {
  name: string; email: string; password: string; operatorId: string; ticket: string;
}) {
  const parsed = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
    operatorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    ticket: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  }).safeParse(input);
  if (!parsed.success) throw new Error('Valid bootstrap details and an approved operator/change reference are required');
  const { name, email, password, operatorId, ticket } = parsed.data;
  const hashed = await hashPassword(password);
  return db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      create: { name, email, password: hashed, role: 'ADMIN' },
      // Never reset an existing authenticator as a side effect of bootstrap.
      update: { name, password: hashed, role: 'ADMIN', sessionVersion: { increment: 1 } },
      select: { id: true },
    });
    // A reset link emailed before this must not overwrite the password just set.
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await appendAuditEvent({ actorUserId: operatorId, action: 'ADMIN.BOOTSTRAPPED', targetType: 'User', targetId: user.id, metadata: { ticket } }, tx);
    return user.id;
  });
}
