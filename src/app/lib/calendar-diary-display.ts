import type { DiaryKind } from '@/app/services/google-diary-classify';
import { calendarBusyForDay } from './calendar-busy-display';

/** One salon-diary entry as Admin → Schedule receives it (admin-calendar-data.ts). Admin-only: titles may hold customers' names. */
export type CalendarDiaryEntry = {
  id: string; kind: DiaryKind; stylistIds: string[]; title: string; colorId: string | null;
  start: string; end: string; allDay: boolean; htmlLink: string | null;
};
export type PlacedDiaryEntry = CalendarDiaryEntry & { startMin: number; endMin: number };

/** The London day's entries, clipped like synced busy time: notes for the strip above the grid, the rest for columns. */
export function diaryForDay(entries: readonly CalendarDiaryEntry[], dayKey: string): { placed: PlacedDiaryEntry[]; notes: PlacedDiaryEntry[] } {
  const day = calendarBusyForDay(entries, dayKey);
  return { placed: day.filter((entry) => entry.kind !== 'NOTE'), notes: day.filter((entry) => entry.kind === 'NOTE') };
}

/** Side-by-side lanes for overlapping entries (the week grid's lanesFor rule). */
export function diaryLanes(items: readonly { id: string; startMin: number; endMin: number }[]): { lane: Map<string, number>; laneCount: number } {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin);
  const laneEnds: number[] = [];
  const lane = new Map<string, number>();
  for (const item of sorted) {
    const index = laneEnds.findIndex((end) => end <= item.startMin);
    const slot = index === -1 ? laneEnds.length : index;
    laneEnds[slot] = item.endMin;
    lane.set(item.id, slot);
  }
  return { lane, laneCount: Math.max(1, laneEnds.length) };
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export function diaryRange(entry: { startMin: number; endMin: number }): string {
  return `${clock(entry.startMin)}–${clock(entry.endMin)}`;
}

export function parseDiaryStylistIds(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
