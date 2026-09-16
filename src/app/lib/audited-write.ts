import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import { appendAuditEvent, type AuditEventInput } from './audit';

/** A failed audit append rolls back the sensitive write as well. */
export async function auditedWrite<T>(event: AuditEventInput, mutate: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const result = await mutate(tx);
    const record = result && typeof result === 'object' ? result : null;
    if (record && 'count' in record && record.count === 0) return result;
    const targetId = event.targetId ?? (record && 'id' in record && typeof record.id === 'string' ? record.id : undefined);
    await appendAuditEvent({ ...event, targetId }, tx);
    return result;
  });
}
