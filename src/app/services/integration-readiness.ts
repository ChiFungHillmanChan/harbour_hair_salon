import 'server-only';
import prisma from '@/app/lib/prisma';
import { getTreatwellApiConfiguration } from './treatwell-api';
import { evaluateSyncCoverage, type SyncCoverage } from './treatwell-sync-coverage';
import { activeMarketplaces } from './marketplace-channels';
import { getSiteSettings } from './site-settings-service';

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
 * Three cheap COUNTs instead of nine queries.
 */
export async function getTreatwellSyncCoverage(): Promise<SyncCoverage> {
  // Settings are unstable_cache'd, so this adds no database round-trip in the
  // common case — but it is what stops the warning firing for a marketplace the
  // salon no longer sells through.
  const [totalStylists, inboundConfigured, outboundConfigured, settings] = await Promise.all([
    prisma.stylist.count(),
    prisma.stylist.count({ where: { treatwellIcalUrl: { not: null } } }),
    prisma.stylist.count({ where: { icalToken: { not: null } } }),
    getSiteSettings(),
  ]);
  return evaluateSyncCoverage({
    totalStylists,
    inboundConfigured,
    outboundConfigured,
    activeMarketplaces: activeMarketplaces(settings).map((m) => m.name),
  });
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
    latestBusy,
    settings,
  ] = await Promise.all([
    prisma.stylist.count(),
    prisma.stylist.count({ where: { treatwellIcalUrl: { not: null } } }),
    prisma.stylist.count({ where: { icalToken: { not: null } } }),
    prisma.stylist.count({ where: { treatwellExternalId: { not: null } } }),
    prisma.service.count(),
    prisma.service.count({ where: { treatwellExternalId: { not: null } } }),
    prisma.appointment.count({ where: { treatwellSyncStatus: 'PENDING' } }),
    prisma.appointment.count({ where: { treatwellSyncStatus: 'FAILED' } }),
    prisma.appointment.count({ where: { treatwellSyncStatus: 'SYNCED' } }),
    prisma.externalBusyBlock.findFirst({
      orderBy: { lastSyncAt: 'desc' },
      select: { lastSyncAt: true },
    }),
    getSiteSettings(),
  ]);

  return {
    treatwell: {
      api: getTreatwellApiConfiguration(),
      adapterImplementation: 'AWAITING_OFFICIAL_API_CONTRACT',
      stylists: { total: stylistTotal, icalMapped, apiMapped: stylistApiMapped, feedTokens },
      services: { total: serviceTotal, apiMapped: serviceApiMapped },
      outbound: { pending, failed, synced },
      lastIcalSyncAt: latestBusy?.lastSyncAt ?? null,
      syncCoverage: evaluateSyncCoverage({
        totalStylists: stylistTotal,
        inboundConfigured: icalMapped,
        outboundConfigured: feedTokens,
        activeMarketplaces: activeMarketplaces(settings).map((m) => m.name),
      }),
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
