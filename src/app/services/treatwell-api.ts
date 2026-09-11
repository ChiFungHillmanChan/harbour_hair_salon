/**
 * Provider-neutral boundary for the future Treatwell API integration.
 *
 * Treatwell's private API payloads and authentication scheme must not leak into
 * booking-service.ts. When official documentation is supplied, implement this
 * port in one adapter and map these canonical commands to Treatwell's contract.
 */

export const TREATWELL_SYNC_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'SYNCED',
  'FAILED',
] as const;

export type TreatwellSyncStatus = (typeof TREATWELL_SYNC_STATUSES)[number];

export type TreatwellApiConfiguration = {
  enabled: boolean;
  configured: boolean;
  missing: string[];
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  venueIdConfigured: boolean;
};

const REQUIRED_API_ENV = [
  'TREATWELL_API_BASE_URL',
  'TREATWELL_API_KEY',
  'TREATWELL_VENUE_ID',
] as const;

/** Read env only when called, never at module initialization. */
export function getTreatwellApiConfiguration(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): TreatwellApiConfiguration {
  const missing = REQUIRED_API_ENV.filter((key) => !env[key]?.trim());

  return {
    enabled: env.TREATWELL_API_ENABLED === 'true',
    configured: missing.length === 0,
    missing: [...missing],
    baseUrlConfigured: Boolean(env.TREATWELL_API_BASE_URL?.trim()),
    apiKeyConfigured: Boolean(env.TREATWELL_API_KEY?.trim()),
    venueIdConfigured: Boolean(env.TREATWELL_VENUE_ID?.trim()),
  };
}

export type TreatwellBookingCommand = {
  /** Stable idempotency/reference value owned by Harbour Hair. */
  externalReference: string;
  treatwellBookingId: string | null;
  action: 'UPSERT' | 'CANCEL';
  startsAt: string;
  endsAt: string;
  stylistExternalId: string;
  serviceExternalId: string;
  customer: {
    name: string | null;
    email: string;
    phone: string | null;
  };
  notes: string | null;
};

export type TreatwellSyncableAppointment = {
  id: string;
  date: Date;
  status: string;
  notes: string | null;
  treatwellBookingId: string | null;
  durationAtBooking?: number | null;
  user: { name: string | null; email: string; phone: string | null };
  stylist: { treatwellExternalId: string | null };
  service: { duration: number; treatwellExternalId: string | null };
};

export type TreatwellCommandResult = {
  bookingId: string;
  providerUpdatedAt?: string;
};

export interface TreatwellApiAdapter {
  ping(): Promise<{ latencyMs: number }>;
  upsertBooking(command: TreatwellBookingCommand): Promise<TreatwellCommandResult>;
  cancelBooking(command: TreatwellBookingCommand): Promise<TreatwellCommandResult>;
}

export type TreatwellCommandBuildResult =
  | { ok: true; command: TreatwellBookingCommand }
  | { ok: false; reason: 'MISSING_STYLIST_MAPPING' | 'MISSING_SERVICE_MAPPING' };

/**
 * Build the stable Harbour Hair → provider command. The future HTTP adapter is
 * responsible only for translating this object into Treatwell's official API.
 */
export function buildTreatwellBookingCommand(
  appointment: TreatwellSyncableAppointment,
): TreatwellCommandBuildResult {
  const stylistExternalId = appointment.stylist.treatwellExternalId?.trim();
  if (!stylistExternalId) return { ok: false, reason: 'MISSING_STYLIST_MAPPING' };

  const serviceExternalId = appointment.service.treatwellExternalId?.trim();
  if (!serviceExternalId) return { ok: false, reason: 'MISSING_SERVICE_MAPPING' };

  const startsAt = new Date(appointment.date);
  const endsAt = new Date(startsAt.getTime() + (appointment.durationAtBooking ?? appointment.service.duration) * 60_000);

  return {
    ok: true,
    command: {
      externalReference: `harbour-hair:${appointment.id}`,
      treatwellBookingId: appointment.treatwellBookingId,
      action: appointment.status === 'CANCELLED' ? 'CANCEL' : 'UPSERT',
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      stylistExternalId,
      serviceExternalId,
      customer: {
        name: appointment.user.name,
        email: appointment.user.email,
        phone: appointment.user.phone,
      },
      notes: appointment.notes,
    },
  };
}

export function initialTreatwellSyncStatus(input: {
  apiEnabled: boolean;
  stylistExternalId: string | null | undefined;
  serviceExternalId: string | null | undefined;
}): TreatwellSyncStatus {
  return input.apiEnabled && input.stylistExternalId?.trim() && input.serviceExternalId?.trim()
    ? 'PENDING'
    : 'NOT_REQUIRED';
}

/** Queue later changes when the booking was already sent, even during an API outage. */
export function changedTreatwellSyncStatus(input: {
  apiReady: boolean;
  treatwellBookingId: string | null | undefined;
  stylistExternalId: string | null | undefined;
  serviceExternalId: string | null | undefined;
}): TreatwellSyncStatus {
  if (input.treatwellBookingId?.trim()) return 'PENDING';
  return initialTreatwellSyncStatus({
    apiEnabled: input.apiReady,
    stylistExternalId: input.stylistExternalId,
    serviceExternalId: input.serviceExternalId,
  });
}
