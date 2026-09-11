import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { CalendarFeedError } from './calendar-ical';
import { validateCalendarFeedUrl } from './calendar-feed-url';
import { CALENDAR_PROVIDERS } from './treatwell-sync-coverage';

export function parseCalendarConnectionSettings(form: FormData, existingUrl: string | null) {
  const input = z.object({
    stylistId: z.string().trim().min(1).max(128),
    provider: z.enum(CALENDAR_PROVIDERS),
    inboundUrl: z.string().max(4_096).default(''),
  }).parse({ stylistId: form.get('stylistId'), provider: form.get('provider'), inboundUrl: form.get('inboundUrl') ?? '' });
  const clear = form.get('clearInboundUrl') === 'on';
  const inboundUrl = clear ? null : input.inboundUrl.trim() ? validateCalendarFeedUrl(input.inboundUrl).toString() : existingUrl;
  const inboundEnabled = form.get('inboundEnabled') === 'on';
  if (inboundEnabled && !inboundUrl) throw new CalendarFeedError('Add a feed URL before enabling inbound sync.');
  return { stylistId: input.stylistId, provider: input.provider, inboundUrl, inboundEnabled, receivesBookings: form.get('receivesBookings') === 'on' };
}


/** Internal action handler. Expected input failures remain safe form messages. */
export async function saveCalendarConnectionSettings(
  formData: FormData,
  db: Pick<PrismaClient, '$transaction'>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const key = z.object({ stylistId: z.string().min(1).max(128), provider: z.enum(CALENDAR_PROVIDERS) })
      .parse({ stylistId: formData.get('stylistId'), provider: formData.get('provider') });
    await db.$transaction(async (tx) => {
      const existing = await tx.calendarConnection.findUnique({ where: { stylistId_provider: key } });
      const input = parseCalendarConnectionSettings(formData, existing?.inboundUrl ?? null);
      const changed = input.inboundUrl !== existing?.inboundUrl || input.inboundEnabled !== existing?.inboundEnabled;
      const data = { ...input, lockToken: null, lockedUntil: null, ...(changed ? { lastSuccessAt: null, lastError: null, lastAttemptAt: null } : {}) };
      if (existing) {
        const saved = await tx.calendarConnection.updateMany({ where: { id: existing.id, updatedAt: existing.updatedAt }, data });
        if (!saved.count) throw new CalendarFeedError('Calendar settings changed while saving. Reload and try again.');
      } else await tx.calendarConnection.create({ data });
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof CalendarFeedError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: 'Check the stylist, provider and feed URL, then try again.' };
    throw error;
  }
}
