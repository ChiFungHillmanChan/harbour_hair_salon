import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { GOOGLE_DIARY_RETENTION_DAYS } from './google-diary-classify';

const DAY_MS = 86_400_000;
const BATCH_SIZE = 250;
const LEASE_MS = 5 * 60_000;
/** Six years (privacy notice: "the record of account events: up to 6 years"). */
export const AUDIT_RETENTION_DAYS = 6 * 365 + 2;

/** Independent of email delivery. Every phase is bounded and rechecks eligibility on mutation. */
export async function runHousekeeping(options: { db?: PrismaClient; now?: Date } = {}) {
  const db = options.db ?? (await import('@/app/lib/prisma')).default;
  const now = options.now ?? new Date();
  const name = 'housekeeping';
  const lockToken = randomUUID();
  const result = { busy: false, recovered: 0, scrubbed: 0, deletedNotifications: 0, deletedBusyBlocks: 0, deletedDiaryEntries: 0, deletedKiosks: 0, deletedAuditEvents: 0 };
  await db.backgroundJobState.upsert({ where: { name }, create: { name }, update: {} });
  const claim = await db.backgroundJobState.updateMany({
    where: { name, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockToken, lockedUntil: new Date(now.getTime() + 2 * 60_000), lastStartedAt: now },
  });
  if (claim.count !== 1) return { ...result, busy: true };

  const updateNotices = async (where: Prisma.NotificationDeliveryWhereInput, data: Prisma.NotificationDeliveryUpdateManyMutationInput) => {
    const rows = await db.notificationDelivery.findMany({ where, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: BATCH_SIZE });
    if (!rows.length) return 0;
    return (await db.notificationDelivery.updateMany({ where: { ...where, id: { in: rows.map((row) => row.id) } }, data })).count;
  };
  try {
    const leaseCutoff = new Date(now.getTime() - LEASE_MS);
    // Preserve attempts, firstAttemptAt, payload and eventKey: delivery still
    // observes its provider idempotency/retry window after recovering a crash.
    result.recovered = await updateNotices({ status: 'PROCESSING', OR: [
      { lockedAt: { lt: leaseCutoff } }, { lockedAt: null, updatedAt: { lt: leaseCutoff } },
    ] }, { status: 'PENDING', lockedAt: null, lockToken: null, nextAttemptAt: now, lastError: 'Expired delivery lease recovered; delivery eligibility will be rechecked.' });

    result.scrubbed = await updateNotices({
      status: { in: ['FAILED', 'PENDING', 'SKIPPED'] },
      createdAt: { lt: new Date(now.getTime() - 30 * DAY_MS) }, payloadJson: { not: '{}' },
    }, { status: 'SKIPPED', payloadJson: '{}', lockedAt: null, lockToken: null, lastError: 'Expired notification; personal payload removed.' });

    const oldNotices: Prisma.NotificationDeliveryWhereInput = {
      status: { in: ['SENT', 'FAILED', 'SKIPPED'] }, payloadJson: '{}',
      createdAt: { lt: new Date(now.getTime() - 365 * DAY_MS) },
    };
    const notices = await db.notificationDelivery.findMany({ where: oldNotices, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: BATCH_SIZE });
    if (notices.length) result.deletedNotifications = (await db.notificationDelivery.deleteMany({ where: { ...oldNotices, id: { in: notices.map((row) => row.id) } } })).count;

    const oldBusy = { end: { lt: new Date(now.getTime() - 30 * DAY_MS) } };
    const blocks = await db.externalBusyBlock.findMany({ where: oldBusy, select: { id: true }, orderBy: [{ end: 'asc' }, { id: 'asc' }], take: BATCH_SIZE });
    if (blocks.length) result.deletedBusyBlocks = (await db.externalBusyBlock.deleteMany({ where: { ...oldBusy, id: { in: blocks.map((row) => row.id) } } })).count;

    // The salon diary copy (privacy notice: deleted 30 days after the entry ends),
    // also while the Google sync is off and no pull runs.
    const oldDiary = { end: { lt: new Date(now.getTime() - GOOGLE_DIARY_RETENTION_DAYS * DAY_MS) } };
    const diary = await db.googleDiaryEntry.findMany({ where: oldDiary, select: { id: true }, orderBy: [{ end: 'asc' }, { id: 'asc' }], take: BATCH_SIZE });
    if (diary.length) result.deletedDiaryEntries = (await db.googleDiaryEntry.deleteMany({ where: { ...oldDiary, id: { in: diary.map((row) => row.id) } } })).count;

    const kioskCutoff = new Date(now.getTime() - 30 * DAY_MS);
    const oldKiosks: Prisma.KioskSessionWhereInput = { OR: [{ expiresAt: { lt: kioskCutoff } }, { revokedAt: { lt: kioskCutoff } }] };
    const kiosks = await db.kioskSession.findMany({ where: oldKiosks, select: { id: true }, orderBy: { id: 'asc' }, take: BATCH_SIZE });
    if (kiosks.length) result.deletedKiosks = (await db.kioskSession.deleteMany({ where: { ...oldKiosks, id: { in: kiosks.map((row) => row.id) } } })).count;

    // The privacy notice keeps the record of account events for up to 6 years.
    const oldAudit: Prisma.AuditEventWhereInput = { createdAt: { lt: new Date(now.getTime() - AUDIT_RETENTION_DAYS * DAY_MS) } };
    const audits = await db.auditEvent.findMany({ where: oldAudit, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: BATCH_SIZE });
    if (audits.length) result.deletedAuditEvents = (await db.auditEvent.deleteMany({ where: { ...oldAudit, id: { in: audits.map((row) => row.id) } } })).count;

    await db.backgroundJobState.updateMany({ where: { name, lockToken }, data: { lastSucceededAt: now, lastError: null, lastResultJson: JSON.stringify(result) } });
    return result;
  } catch (error) {
    await db.backgroundJobState.updateMany({ where: { name, lockToken }, data: { lastFailedAt: now, lastError: 'Housekeeping failed. Check database availability and retention backlog.' } });
    // The original error, so the route's log keeps its Prisma code (it logs
    // only the name and code, never a message that could quote the host).
    throw error;
  } finally {
    await db.backgroundJobState.updateMany({ where: { name, lockToken }, data: { lockToken: null, lockedUntil: null } });
  }
}
