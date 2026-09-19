import type { ExternalBusyBlock } from '@prisma/client';
import { salonDateKey, salonMinutesOfDay } from '@/app/services/salon-time';

export type CalendarBusyBlock = Pick<ExternalBusyBlock, 'id' | 'stylistId' | 'source'> & {
  start: string;
  end: string;
  lastSyncAt: string;
};

/** Clip to the London wall-clock day, including overnight and all-day events. */
export function calendarBusyForDay(blocks: CalendarBusyBlock[], dayKey: string) {
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

export function calendarBusyLabel(block: CalendarBusyBlock, stylist: string, startMin: number, endMin: number) {
  const provider = block.source === 'TREATWELL' ? 'Treatwell' : block.source === 'FRESHA' ? 'Fresha' : 'External calendar';
  const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const range = `${time(startMin)}–${time(endMin)}`;
  const synced = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(block.lastSyncAt));
  return { provider, range, synced, detail: `${provider} · ${stylist} · ${range} (London time). Last imported ${synced}. Manage this time in ${provider}.` };
}
