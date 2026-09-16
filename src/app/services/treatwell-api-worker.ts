import 'server-only';
import type {
  TreatwellApiAdapter,
  TreatwellSyncableAppointment,
} from './treatwell-api';

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

/**
 * Deliberately unavailable until an official API contract provides versioned
 * writes and retry/idempotency guarantees. A local lease cannot stop a slow
 * provider request from overwriting a later cancellation at the provider.
 * Keeping this boundary fail-closed prevents an injected adapter from silently
 * reviving the former read/send/update-by-id race. ICS synchronization remains
 * the supported integration and does not call this function.
 */
export async function syncPendingTreatwellBookings(
  _adapter: TreatwellApiAdapter,
  _deps?: { db?: TreatwellWorkerDb; now?: Date; limit?: number },
): Promise<TreatwellWorkerResult[]> {
  void _adapter;
  void _deps;
  throw new Error('Treatwell API delivery is unavailable until the official API supports a validated versioned, idempotent worker.');
}
