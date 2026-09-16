import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/app/lib/prisma';

type AuditScalar = string | number | boolean | null;
export type AuditEventInput = {
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  /** Controlled facts only: never pass form data, notes, tokens or credentials. */
  metadata?: Record<string, AuditScalar>;
};

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SENSITIVE_KEY = /password|secret|token|credential|authorization|cookie|email|phone|address|name|pin|otp|recovery|code/i;

/** Append inside the business transaction when an event describes a write. */
export async function appendAuditEvent(input: AuditEventInput, tx?: Prisma.TransactionClient) {
  if (!/^[A-Z][A-Z0-9_.]{0,79}$/.test(input.action) || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(input.targetType)) {
    throw new Error('Invalid audit event type');
  }
  if ([input.actorUserId, input.targetId].some((id) => id != null && !ID.test(id))) throw new Error('Invalid audit target');
  const metadata: Record<string, AuditScalar> = {};
  for (const [key, value] of Object.entries(input.metadata ?? {}).slice(0, 24)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || SENSITIVE_KEY.test(key)) continue;
    if (typeof value === 'string') metadata[key] = value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 300);
    else if (typeof value === 'boolean' || value === null || (typeof value === 'number' && Number.isFinite(value))) metadata[key] = value;
  }
  return (tx ?? prisma).auditEvent.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadataJson: JSON.stringify(metadata),
    },
    select: { id: true },
  });
}
