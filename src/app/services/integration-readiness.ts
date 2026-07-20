import 'server-only';
import prisma from '@/app/lib/prisma';
import { getTreatwellApiConfiguration } from './treatwell-api';

export type IntegrationReadiness = {
  treatwell: {
    api: ReturnType<typeof getTreatwellApiConfiguration>;
    adapterImplementation: 'AWAITING_OFFICIAL_API_CONTRACT';
    stylists: { total: number; icalMapped: number; apiMapped: number };
    services: { total: number; apiMapped: number };
    outbound: { pending: number; failed: number; synced: number };
    lastIcalSyncAt: Date | null;
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

/** Admin-only caller. Returns booleans/counts and never returns secret values. */
export async function getIntegrationReadiness(): Promise<IntegrationReadiness> {
  const [
    stylistTotal,
    icalMapped,
    stylistApiMapped,
    serviceTotal,
    serviceApiMapped,
    pending,
    failed,
    synced,
    latestBusy,
  ] = await Promise.all([
    prisma.stylist.count(),
    prisma.stylist.count({ where: { treatwellIcalUrl: { not: null } } }),
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
  ]);

  return {
    treatwell: {
      api: getTreatwellApiConfiguration(),
      adapterImplementation: 'AWAITING_OFFICIAL_API_CONTRACT',
      stylists: { total: stylistTotal, icalMapped, apiMapped: stylistApiMapped },
      services: { total: serviceTotal, apiMapped: serviceApiMapped },
      outbound: { pending, failed, synced },
      lastIcalSyncAt: latestBusy?.lastSyncAt ?? null,
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
