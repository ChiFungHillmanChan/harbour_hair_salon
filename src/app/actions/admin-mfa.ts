'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { requirePendingAdminMfa, clearAdminMfaChallenge } from '@/app/lib/admin-mfa';
import { authenticatorUri, createRecoveryCodes, decryptMfaSecret, encryptMfaSecret, hashRecoveryCode, matchTotpStep, newMfaSecret } from '@/app/lib/mfa-crypto';
import { verifyPassword } from '@/app/lib/password';
import { createSession } from '@/app/lib/session';
import { createRateLimiter } from '@/app/lib/rate-limit';
import { appendAuditEvent } from '@/app/lib/audit';

export type MfaState = { error?: string; secret?: string; uri?: string; recoveryCodes?: string[] };
const limiter = createRateLimiter({ prefix: 'rl:admin-mfa', limit: 8, windowSeconds: 5 * 60 });
const INVALID = 'The code is invalid, expired or already used. Try the next authenticator code or an unused recovery code.';

async function allowed(userId: string, sessionVersion: number) {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await limiter.check(`ip:${ip}`))) return false;
  return prisma.$transaction(async (tx) => {
    // The write holds this account's row lock until the attempt is recorded.
    // Every instance therefore shares one budget, including during Redis
    // outages. A reset/demotion also invalidates the first-factor proof here.
    const current = await tx.user.updateMany({
      where: { id: userId, role: 'ADMIN', sessionVersion }, data: { updatedAt: new Date() },
    });
    if (current.count !== 1) return false;
    const attempts = await tx.auditEvent.count({
      where: { actorUserId: userId, action: 'AUTH.MFA_ATTEMPT', createdAt: { gte: new Date(Date.now() - 5 * 60_000) } },
    });
    if (attempts >= 8) return false;
    await appendAuditEvent({ actorUserId: userId, action: 'AUTH.MFA_ATTEMPT', targetType: 'User', targetId: userId }, tx);
    return true;
  });
}

export async function beginMfaEnrollment(_previous: MfaState, formData: FormData): Promise<MfaState> {
  const user = await requirePendingAdminMfa();
  if (!(await allowed(user.id, user.sessionVersion))) return { error: 'Too many attempts. Wait five minutes and sign in again.' };
  if (user.mfaEnabledAt) return { error: 'Authenticator verification is already enabled. Sign in with your existing code.' };
  const password = z.string().max(128).safeParse(formData.get('password') ?? '');
  if (!password.success || (user.password && !(await verifyPassword(password.data, user.password)))) return { error: 'Enter your current password.' };
  // Google-only administrators already proved their identity in the fresh
  // signed first-factor challenge; they do not have a local password to enter.
  let secret: string;
  if (user.mfaPendingSecretEncrypted && user.mfaPendingExpiresAt && user.mfaPendingExpiresAt.getTime() > Date.now()) {
    secret = decryptMfaSecret(user.mfaPendingSecretEncrypted);
  } else {
    secret = newMfaSecret();
    const changed = await prisma.user.updateMany({
      where: { id: user.id, role: 'ADMIN', sessionVersion: user.sessionVersion, mfaEnabledAt: null, mfaPendingSecretEncrypted: user.mfaPendingSecretEncrypted },
      data: { mfaPendingSecretEncrypted: encryptMfaSecret(secret), mfaPendingExpiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    if (changed.count !== 1) return { error: 'Your account changed. Sign in again to continue.' };
  }
  return { secret, uri: authenticatorUri(secret, user.email) };
}

export async function finishMfaEnrollment(_previous: MfaState, formData: FormData): Promise<MfaState> {
  const user = await requirePendingAdminMfa();
  if (!(await allowed(user.id, user.sessionVersion))) return { error: 'Too many attempts. Wait five minutes and sign in again.' };
  const token = z.string().regex(/^\d{6}$/).safeParse(formData.get('code'));
  if (!token.success || user.mfaEnabledAt || !user.mfaPendingSecretEncrypted || !user.mfaPendingExpiresAt || user.mfaPendingExpiresAt.getTime() <= Date.now()) return { error: 'Start authenticator setup again.' };
  const step = matchTotpStep(decryptMfaSecret(user.mfaPendingSecretEncrypted), token.data);
  if (step === null) return { error: INVALID };
  const recoveryCodes = createRecoveryCodes();
  const enrolled = await prisma.$transaction(async (tx) => {
    const claim = await tx.user.updateMany({
      where: { id: user.id, role: 'ADMIN', sessionVersion: user.sessionVersion, mfaEnabledAt: null, mfaPendingSecretEncrypted: user.mfaPendingSecretEncrypted, mfaPendingExpiresAt: { gt: new Date() } },
      data: {
        mfaSecretEncrypted: user.mfaPendingSecretEncrypted, mfaEnabledAt: new Date(), mfaLastUsedStep: step,
        mfaRecoveryCodesJson: JSON.stringify(recoveryCodes.map(hashRecoveryCode)),
        mfaPendingSecretEncrypted: null, mfaPendingExpiresAt: null, sessionVersion: { increment: 1 },
      },
    });
    if (claim.count !== 1) return false;
    await appendAuditEvent({ actorUserId: user.id, action: 'AUTH.MFA_ENROLLED', targetType: 'User', targetId: user.id }, tx);
    return true;
  });
  if (!enrolled) return { error: 'Your account changed. Sign in again to continue.' };
  await createSession(user.id, 'ADMIN', user.sessionVersion + 1, true);
  await clearAdminMfaChallenge();
  return { recoveryCodes };
}

export async function verifyAdminMfa(_previous: MfaState, formData: FormData): Promise<MfaState> {
  const user = await requirePendingAdminMfa();
  if (!(await allowed(user.id, user.sessionVersion))) return { error: 'Too many attempts. Wait five minutes and sign in again.' };
  const parsed = z.string().trim().min(6).max(64).safeParse(formData.get('code'));
  if (!parsed.success) return { error: INVALID };
  const verified = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, sessionVersion: true, mfaEnabledAt: true, mfaSecretEncrypted: true, mfaLastUsedStep: true, mfaRecoveryCodesJson: true },
    });
    if (!current || current.role !== 'ADMIN' || current.sessionVersion !== user.sessionVersion || !current.mfaEnabledAt || !current.mfaSecretEncrypted) return false;
    const step = matchTotpStep(decryptMfaSecret(current.mfaSecretEncrypted), parsed.data);
    let changed;
    let method: 'totp' | 'recovery';
    if (step !== null) {
      method = 'totp';
      changed = await tx.user.updateMany({
        where: { id: user.id, role: 'ADMIN', sessionVersion: user.sessionVersion, mfaSecretEncrypted: current.mfaSecretEncrypted, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
        data: { mfaLastUsedStep: step },
      });
    } else {
      method = 'recovery';
      const stored: unknown = JSON.parse(current.mfaRecoveryCodesJson);
      if (!Array.isArray(stored) || !stored.every((value): value is string => typeof value === 'string')) return false;
      const hash = hashRecoveryCode(parsed.data);
      if (!stored.includes(hash)) return false;
      changed = await tx.user.updateMany({
        where: { id: user.id, role: 'ADMIN', sessionVersion: user.sessionVersion, mfaRecoveryCodesJson: current.mfaRecoveryCodesJson },
        data: { mfaRecoveryCodesJson: JSON.stringify(stored.filter((value) => value !== hash)) },
      });
    }
    if (changed.count !== 1) return false;
    await appendAuditEvent({ actorUserId: user.id, action: 'AUTH.LOGIN', targetType: 'User', targetId: user.id, metadata: { method } }, tx);
    return true;
  });
  if (!verified) return { error: INVALID };
  await createSession(user.id, 'ADMIN', user.sessionVersion, true);
  await clearAdminMfaChallenge();
  redirect('/admin');
}
