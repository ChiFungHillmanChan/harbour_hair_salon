import { appendAuditEvent } from '@/app/lib/audit';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { CalendarFeedError } from './calendar-ical';
import { validateCalendarFeedUrl } from './calendar-feed-url';
import { CALENDAR_PROVIDERS } from './treatwell-sync-coverage';

/**
 * Why calendar settings were not saved. The admin page shows the code in the
 * admin's language (adminOps.integrations.calendarErrors); `message` stays
 * English for logs and callers without a language.
 */
export type CalendarSettingsErrorCode = 'INVALID_INPUT' | 'INVALID_URL' | 'UNSAFE_URL' | 'URL_REQUIRED' | 'CHANGED';

export class CalendarSettingsError extends CalendarFeedError {
  readonly code: CalendarSettingsErrorCode;
  constructor(code: CalendarSettingsErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function validatedFeedUrl(value: string): string {
  if (!URL.canParse(value.trim())) throw new CalendarSettingsError('INVALID_URL', 'Enter a valid HTTPS calendar feed URL.');
  try {
    return validateCalendarFeedUrl(value).toString();
  } catch (error) {
    if (error instanceof CalendarFeedError) throw new CalendarSettingsError('UNSAFE_URL', error.message);
    throw error;
  }
}

export function parseCalendarConnectionSettings(form: FormData, existingUrl: string | null) {
  const input = z.object({
    stylistId: z.string().trim().min(1).max(128),
    provider: z.enum(CALENDAR_PROVIDERS),
    inboundUrl: z.string().max(4_096).default(''),
  }).parse({ stylistId: form.get('stylistId'), provider: form.get('provider'), inboundUrl: form.get('inboundUrl') ?? '' });
  const clear = form.get('clearInboundUrl') === 'on';
  const inboundUrl = clear ? null : input.inboundUrl.trim() ? validatedFeedUrl(input.inboundUrl) : existingUrl;
  const inboundEnabled = form.get('inboundEnabled') === 'on';
  if (inboundEnabled && !inboundUrl) throw new CalendarSettingsError('URL_REQUIRED', 'Add a feed URL before enabling inbound sync.');
  return { stylistId: input.stylistId, provider: input.provider, inboundUrl, inboundEnabled, receivesBookings: form.get('receivesBookings') === 'on' };
}


/** Internal action handler. Expected input failures remain safe form messages. */
export async function saveCalendarConnectionSettings(
  formData: FormData,
  db: Pick<PrismaClient, '$transaction'>,
  actorUserId?: string,
): Promise<{ ok: boolean; error?: string; code?: CalendarSettingsErrorCode }> {
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
        if (!saved.count) throw new CalendarSettingsError('CHANGED', 'Calendar settings changed while saving. Reload and try again.');
      } else await tx.calendarConnection.create({ data });
      if (actorUserId) await appendAuditEvent({ actorUserId, action: 'CALENDAR.SETTINGS', targetType: 'Stylist', targetId: key.stylistId, metadata: { provider: key.provider, inboundEnabled: input.inboundEnabled, receivesBookings: input.receivesBookings } }, tx);
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof CalendarSettingsError) return { ok: false, error: error.message, code: error.code };
    if (error instanceof CalendarFeedError) return { ok: false, error: error.message, code: 'INVALID_INPUT' };
    if (error instanceof z.ZodError) return { ok: false, error: 'Check the stylist, provider and feed URL, then try again.', code: 'INVALID_INPUT' };
    throw error;
  }
}
