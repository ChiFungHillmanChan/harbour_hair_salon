import 'server-only';
import prisma from '@/app/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getTreatwellApiConfiguration } from './treatwell-api';
import { evaluateSyncCoverage, type SyncCoverage } from './treatwell-sync-coverage';


export type IntegrationReadiness = {
  treatwell: {
    api: ReturnType<typeof getTreatwellApiConfiguration>;
    adapterImplementation: 'AWAITING_OFFICIAL_API_CONTRACT';
    stylists: { total: number; icalMapped: number; apiMapped: number; feedTokens: number };
    services: { total: number; apiMapped: number };
    outbound: { pending: number; failed: number; synced: number };
    lastIcalSyncAt: Date | null;
    /** Whether two-way calendar sync actually covers every stylist. */
    syncCoverage: SyncCoverage;
  };
  resend: {
    apiKeyConfigured: boolean;
    fromAddressConfigured: boolean;
    audienceConfigured: boolean;
    replyToConfigured: boolean;
  };
  cdn: {
    strategy: 'VERCEL_ISR';
    homeRevalidateSeconds: number;
    siteUrlConfigured: boolean;
  };
};

export type OutboundIcalFeed = {
  stylistId: string;
  name: string;
  /** Full secret feed URL to paste into Treatwell Connect, or null until generated. */
  feedUrl: string | null;
};

/**
 * Admin-only caller. Lists each stylist's outbound busy-feed URL (contains the
 * secret token — show only inside the admin panel).
 */
export async function listOutboundIcalFeeds(siteUrl: string): Promise<OutboundIcalFeed[]> {
  const stylists = await prisma.stylist.findMany({
    where: { isActive: true },
    select: { id: true, name: true, icalToken: true },
    orderBy: { name: 'asc' },
  });
  return stylists.map((s) => ({
    stylistId: s.id,
    name: s.name,
    feedUrl: s.icalToken ? `${siteUrl}/api/ical/${s.id}?token=${s.icalToken}` : null,
  }));
}

/**
 * Just the sync-coverage verdict, for callers (like the admin dashboard) that
 * want the double-booking warning without paying for the full readiness report.
 * Loads current staff hours and calendar connection evidence.
 */
export async function getCalendarSyncCoverage(db: Pick<Prisma.TransactionClient, 'stylist'> = prisma, now = new Date()): Promise<SyncCoverage> {
  const stylists = await db.stylist.findMany({
    // Retired staff are excluded deliberately. `evaluateSyncCoverage` demands a
    // complete, valid week and a covered feed from every stylist it is handed,
    // so leaving a retired one in would make `safeToEnableOnlineBooking` false
    // forever and close booking for the whole salon.
    where: { isActive: true },
    select: {
      id: true, name: true, icalToken: true,
      availabilities: { select: { dayOfWeek: true, isOff: true, startTime: true, endTime: true } },
      calendarConnections: { select: {
        provider: true, receivesBookings: true, inboundUrl: true, inboundEnabled: true,
        outboundConfirmedAt: true, lastSuccessAt: true, lastError: true,
      } },
    },
  });
  return evaluateSyncCoverage({ stylists, now });
}

/** Uses the caller's transaction; never falls back to another connection. */
export async function checkCalendarBookingReadiness(
  db: Pick<Prisma.TransactionClient, 'stylist'>,
  now = new Date(),
): Promise<{ ready: boolean; blockers: string[] }> {
  const coverage = await getCalendarSyncCoverage(db, now);
  return { ready: coverage.safeToEnableOnlineBooking, blockers: coverage.blockers };
}

/** Compatibility for existing dashboard consumers. */
export async function getTreatwellSyncCoverage(): Promise<SyncCoverage> {
  return getCalendarSyncCoverage();
}

/** Admin-only caller. Returns booleans/counts and never returns secret values. */
export async function getIntegrationReadiness(): Promise<IntegrationReadiness> {
  const [
    stylistTotal,
    icalMapped,
    feedTokens,
    stylistApiMapped,
    serviceTotal,
    serviceApiMapped,
    pending,
    failed,
    synced,
    latestConnection,
    syncCoverage,
  ] = await Promise.all([
    prisma.stylist.count(),
    prisma.calendarConnection.count({ where: { provider: 'TREATWELL', inboundEnabled: true, inboundUrl: { not: null } } }),
    prisma.stylist.count({ where: { icalToken: { not: null } } }),
    prisma.stylist.count({ where: { treatwellExternalId: { not: null } } }),
    prisma.service.count(),
    prisma.service.count({ where: { treatwellExternalId: { not: null } } }),
    prisma.appointment.count({ where: { treatwellSyncStatus: 'PENDING' } }),
    prisma.appointment.count({ where: { treatwellSyncStatus: 'FAILED' } }),
    prisma.appointment.count({ where: { treatwellSyncStatus: 'SYNCED' } }),
    prisma.calendarConnection.findFirst({
      where: { provider: 'TREATWELL', lastSuccessAt: { not: null } },
      orderBy: { lastSuccessAt: 'desc' },
      select: { lastSuccessAt: true },
    }),
    getCalendarSyncCoverage(),
  ]);

  return {
    treatwell: {
      api: getTreatwellApiConfiguration(),
      adapterImplementation: 'AWAITING_OFFICIAL_API_CONTRACT',
      stylists: { total: stylistTotal, icalMapped, apiMapped: stylistApiMapped, feedTokens },
      services: { total: serviceTotal, apiMapped: serviceApiMapped },
      outbound: { pending, failed, synced },
      lastIcalSyncAt: latestConnection?.lastSuccessAt ?? null,
      syncCoverage,
    },
    resend: {
      apiKeyConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
      fromAddressConfigured: Boolean(process.env.EMAIL_FROM?.trim()),
      audienceConfigured: Boolean(process.env.RESEND_AUDIENCE_ID?.trim()),
      replyToConfigured: Boolean(process.env.EMAIL_REPLY_TO?.trim()),
    },
    cdn: {
      strategy: 'VERCEL_ISR',
      homeRevalidateSeconds: 3600,
      siteUrlConfigured: Boolean(process.env.NEXT_PUBLIC_SITE_URL?.trim()),
    },
  };
}

/** Private feed URLs are projected to a boolean before reaching UI components. */
export async function listCalendarConnectionsForAdmin(siteUrl: string) {
  const stylists = await prisma.stylist.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, icalToken: true,
      calendarConnections: { select: { id: true, provider: true, receivesBookings: true, inboundUrl: true, inboundEnabled: true, outboundConfirmedAt: true, lastAttemptAt: true, lastSuccessAt: true, lastError: true } },
    },
  });
  return stylists.map((stylist) => ({
    id: stylist.id, name: stylist.name, feedToken: stylist.icalToken,
    feedUrl: stylist.icalToken ? `${siteUrl.replace(/\/$/, '')}/api/ical/${stylist.id}?token=${stylist.icalToken}` : null,
    connections: stylist.calendarConnections.map(({ inboundUrl, ...connection }) => ({ ...connection, inboundUrlConfigured: Boolean(inboundUrl?.trim()) })),
  }));
}
