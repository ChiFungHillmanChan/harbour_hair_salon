import 'server-only';
import type {
  TreatwellApiAdapter,
  TreatwellSyncableAppointment,
} from './treatwell-api';
import { buildTreatwellBookingCommand } from './treatwell-api';

type AppointmentUpdate = {
  where: { id: string };
  data: {
    treatwellSyncStatus: 'SYNCED' | 'FAILED';
    treatwellBookingId?: string;
    treatwellSyncedAt?: Date;
    treatwellSyncError: string | null;
  };
};

export type TreatwellWorkerDb = {
  appointment: {
    findMany(args: unknown): Promise<TreatwellSyncableAppointment[]>;
    update(args: AppointmentUpdate): Promise<unknown>;
  };
};

export type TreatwellWorkerResult = {
  appointmentId: string;
  ok: boolean;
  action?: 'UPSERT' | 'CANCEL';
  error?: string;
};

const MAX_ERROR_LENGTH = 500;

/**
 * Process the durable outbound queue through an injected official API adapter.
 * This owns retries/state transitions; the future adapter owns only HTTP/auth.
 */
export async function syncPendingTreatwellBookings(
  adapter: TreatwellApiAdapter,
  deps: { db?: TreatwellWorkerDb; now?: Date; limit?: number } = {},
): Promise<TreatwellWorkerResult[]> {
  const db = deps.db ?? (await import('@/app/lib/prisma')).default as unknown as TreatwellWorkerDb;
  const now = deps.now ?? new Date();
  const limit = Math.min(Math.max(deps.limit ?? 25, 1), 100);

  const appointments = await db.appointment.findMany({
    where: { treatwellSyncStatus: 'PENDING' },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    include: {
      user: { select: { name: true, email: true, phone: true } },
      stylist: { select: { treatwellExternalId: true } },
      service: { select: { duration: true, treatwellExternalId: true } },
    },
  });

  const results: TreatwellWorkerResult[] = [];
  for (const appointment of appointments) {
    const built = buildTreatwellBookingCommand(appointment);
    if (!built.ok) {
      await db.appointment.update({
        where: { id: appointment.id },
        data: { treatwellSyncStatus: 'FAILED', treatwellSyncError: built.reason },
      });
      results.push({ appointmentId: appointment.id, ok: false, error: built.reason });
      continue;
    }

    try {
      const providerResult = built.command.action === 'CANCEL'
        ? await adapter.cancelBooking(built.command)
        : await adapter.upsertBooking(built.command);

      await db.appointment.update({
        where: { id: appointment.id },
        data: {
          treatwellSyncStatus: 'SYNCED',
          treatwellBookingId: providerResult.bookingId,
          treatwellSyncedAt: now,
          treatwellSyncError: null,
        },
      });
      results.push({ appointmentId: appointment.id, ok: true, action: built.command.action });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
      await db.appointment.update({
        where: { id: appointment.id },
        data: { treatwellSyncStatus: 'FAILED', treatwellSyncError: message },
      });
      results.push({ appointmentId: appointment.id, ok: false, action: built.command.action, error: message });
    }
  }

  return results;
}
