import type { ExternalBusyBlock } from '@prisma/client';
import { formatSalonDateTime } from '@/i18n/dates';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages/types-client';
import { salonDateKey, salonMinutesOfDay } from '@/app/services/salon-time';
import { busyKindOf, type BusyKind } from '@/app/services/calendar-busy-kind';

export type CalendarBusyBlock = Pick<ExternalBusyBlock, 'id' | 'stylistId' | 'source' | 'summary'> & {
  start: string;
  end: string;
  lastSyncAt: string;
};

/** Clip to the London wall-clock day, including overnight and all-day events. */
export function calendarBusyForDay<T extends { start: string; end: string }>(blocks: readonly T[], dayKey: string): (T & { startMin: number; endMin: number })[] {
  return blocks.flatMap((block) => {
    const start = new Date(block.start);
    const end = new Date(block.end);
    if (!(end > start)) return [];
    const firstDay = salonDateKey(start);
    const lastDay = salonDateKey(end);
    if (firstDay > dayKey || lastDay < dayKey) return [];
    const startMin = firstDay < dayKey ? 0 : salonMinutesOfDay(start);
    const endMin = lastDay > dayKey ? 1440 : salonMinutesOfDay(end);
    if (lastDay === dayKey && endMin === 0) return [];
    return [{ ...block, startMin, endMin }];
  });
}

export type WorkingWindow = { startTime: string; endTime: string };

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Earliest start and latest finish of everyone rostered that day; null when nobody is. */
export function salonWorkingWindow(windows: readonly (WorkingWindow | null | undefined)[]): WorkingWindow | null {
  const rostered = windows.filter((window): window is WorkingWindow => Boolean(window));
  if (rostered.length === 0) return null;
  return {
    startTime: rostered.map((window) => window.startTime).sort()[0],
    endTime: rostered.map((window) => window.endTime).sort()[rostered.length - 1],
  };
}

/**
 * A synced block that covers the whole working window — how a Fresha "Pause"
 * (a day off) arrives. `window` is the stylist's own hours, or the salon's when
 * they are not rostered that day; with neither, only a full calendar day counts.
 */
export function isWholeDayBlock(block: { startMin: number; endMin: number }, window: WorkingWindow | null): boolean {
  if (!window) return block.startMin <= 0 && block.endMin >= 1440;
  return block.startMin <= minutesOf(window.startTime) && block.endMin >= minutesOf(window.endTime);
}

/**
 * Platform names are brands and stay as they are in every language. `kind`
 * says what the provider called the time: a stylist's blocked time (lunch,
 * holiday) must not read like a customer's booking. A whole-day block is
 * "Unavailable" whatever its kind; without a known kind the label is the
 * provider's name alone. `brand` is always the provider's name.
 */
export function calendarBusyLabel(block: CalendarBusyBlock, stylist: string, startMin: number, endMin: number, t: Translate<Messages['adminSchedule']>, wholeDay = false) {
  const provider = block.source === 'TREATWELL' ? 'Treatwell' : block.source === 'FRESHA' ? 'Fresha' : block.source === 'GOOGLE' ? 'Google' : t('busy.external');
  const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const range = `${time(startMin)}–${time(endMin)}`;
  const synced = formatSalonDateTime(t.locale, new Date(block.lastSyncAt));
  const kind: BusyKind | null = busyKindOf(block.summary);
  if (wholeDay) {
    return { provider: t('busy.unavailable'), range, synced, detail: t('busy.unavailableDetail', { provider, stylist, range, synced }), unavailable: true, kind, brand: provider };
  }
  if (kind === 'blocked') {
    return { provider: t('busy.blocked'), range, synced, detail: t('busy.blockedDetail', { provider, stylist, range, synced }), unavailable: false, kind, brand: provider };
  }
  if (kind === 'booking') {
    return { provider: t('busy.booking', { provider }), range, synced, detail: t('busy.bookingDetail', { provider, stylist, range, synced }), unavailable: false, kind, brand: provider };
  }
  return { provider, range, synced, detail: t('busy.detail', { provider, stylist, range, synced }), unavailable: false, kind, brand: provider };
}
