import 'server-only';

// How the salon diary is read (docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §3):
// active stylists' Google colours and names, and the two salon colours, from the
// live rows (never the day-cached site settings).

import type { PrismaClient } from '@prisma/client';
import { DEFAULT_LEAVE_COLOR_ID, DEFAULT_UNASSIGNED_COLOR_ID, isGoogleColorId } from '@/app/lib/calendar-colors';
import type { DiaryConfig } from './google-diary-classify';

type ConfigDb = Pick<PrismaClient, 'stylist' | 'siteSettings'>;

export async function loadDiaryConfig(db?: ConfigDb): Promise<DiaryConfig> {
  const client = db ?? (await import('@/app/lib/prisma')).default;
  const [stylists, settings] = await Promise.all([
    client.stylist.findMany({
      where: { isActive: true },
      select: { id: true, name: true, googleColorId: true, googleAliases: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    client.siteSettings.findUnique({ where: { id: 'singleton' }, select: { googleUnassignedColorId: true, googleLeaveColorId: true } }),
  ]);
  return {
    stylists,
    unassignedColorId: isGoogleColorId(settings?.googleUnassignedColorId) ? settings.googleUnassignedColorId : DEFAULT_UNASSIGNED_COLOR_ID,
    leaveColorId: isGoogleColorId(settings?.googleLeaveColorId) ? settings.googleLeaveColorId : DEFAULT_LEAVE_COLOR_ID,
  };
}
