import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

const DAY_MS = 86_400_000;
const BATCH_SIZE = 250;
const LEASE_MS = 5 * 60_000;

/** Independent of email delivery. Every phase is bounded and rechecks eligibility on mutation. */
export async function runHousekeeping(options: { db?: PrismaClient; now?: Date } = {}) {
  const db = options.db ?? (await import('@/app/lib/prisma')).default;
  const now = options.now ?? new Date();
  const name = 'housekeeping';
  const lockToken = randomUUID();
  const result = { busy: false, recovered: 0, scrubbed: 0, deletedNotifications: 0, deletedBusyBlocks: 0, deletedKiosks: 0 };
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

    const kioskCutoff = new Date(now.getTime() - 30 * DAY_MS);
    const oldKiosks: Prisma.KioskSessionWhereInput = { OR: [{ expiresAt: { lt: kioskCutoff } }, { revokedAt: { lt: kioskCutoff } }] };
    const kiosks = await db.kioskSession.findMany({ where: oldKiosks, select: { id: true }, orderBy: { id: 'asc' }, take: BATCH_SIZE });
    if (kiosks.length) result.deletedKiosks = (await db.kioskSession.deleteMany({ where: { ...oldKiosks, id: { in: kiosks.map((row) => row.id) } } })).count;

    await db.backgroundJobState.updateMany({ where: { name, lockToken }, data: { lastSucceededAt: now, lastError: null, lastResultJson: JSON.stringify(result) } });
    return result;
  } catch {
    await db.backgroundJobState.updateMany({ where: { name, lockToken }, data: { lastFailedAt: now, lastError: 'Housekeeping failed. Check database availability and retention backlog.' } });
    throw new Error('Housekeeping failed');
  } finally {
    await db.backgroundJobState.updateMany({ where: { name, lockToken }, data: { lockToken: null, lockedUntil: null } });
  }
}
