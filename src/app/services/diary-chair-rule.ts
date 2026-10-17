// The chair rule (docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §6).
// Pure: no database. A booking for stylist X over [s, e) is allowed only when the
// red (UNASSIGNED) diary events overlapping it can still be served by OTHER
// stylists: k = the most of them, clipped to [s, e), at any one instant; F = the
// active stylists other than X who work that day over the whole clipped span and
// have no appointment or busy block overlapping it. Allowed when k <= |F|.
// Deliberately conservative: a stylist free for only part of the span does not count.

import type { WorkingHours } from './booking-days';
import type { BookedInterval } from './scheduling';
import { resolveSalonDateTime, salonDateKey } from './salon-time';

export type ChairInterval = { start: Date; end: Date };
export type ChairContext = {
  /** UNASSIGNED diary entries overlapping the window read. */
  unassigned: readonly ChairInterval[];
  /** Every active stylist's working rows (isOff false), by stylist id. */
  hoursByStylist: ReadonlyMap<string, readonly WorkingHours[]>;
  /** Every active stylist's appointments and busy blocks, by stylist id. */
  busyByStylist: ReadonlyMap<string, readonly BookedInterval[]>;
};
export type ChairCheck = { allowed: true } | { allowed: false; needed: number; free: number; start: Date; end: Date };

/** The most intervals overlapping at any instant. Half-open: one ending as another starts is not an overlap. */
export function maxConcurrent(intervals: readonly ChairInterval[]): number {
  const points = intervals.flatMap((interval) => [[interval.start.getTime(), 1], [interval.end.getTime(), -1]] as const);
  // At the same instant an end (-1) sorts before a start (+1).
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let most = 0;
  for (const [, step] of points) {
    current += step;
    most = Math.max(most, current);
  }
  return most;
}

export function checkDiaryChair(ctx: ChairContext | null, stylistId: string, start: Date, durationMin: number): ChairCheck {
  if (!ctx || ctx.unassigned.length === 0) return { allowed: true };
  const startMs = start.getTime();
  const endMs = startMs + durationMin * 60_000;
  const clipped = ctx.unassigned
    .filter((interval) => interval.start.getTime() < endMs && startMs < interval.end.getTime())
    .map((interval) => ({ start: new Date(Math.max(interval.start.getTime(), startMs)), end: new Date(Math.min(interval.end.getTime(), endMs)) }));
  if (clipped.length === 0) return { allowed: true };
  const needed = maxConcurrent(clipped);
  const span = {
    start: new Date(Math.min(...clipped.map((interval) => interval.start.getTime()))),
    end: new Date(Math.max(...clipped.map((interval) => interval.end.getTime()))),
  };
  // The booking sits inside one salon day (it fits its stylist's hours), so the span does too.
  const dateStr = salonDateKey(start);
  const { dayOfWeek } = resolveSalonDateTime(dateStr, '12:00');
  let free = 0;
  for (const [otherId, rows] of ctx.hoursByStylist) {
    if (otherId === stylistId) continue;
    const hours = rows.find((row) => row.dayOfWeek === dayOfWeek);
    if (!hours) continue;
    const opens = resolveSalonDateTime(dateStr, hours.startTime).utc.getTime();
    const closes = resolveSalonDateTime(dateStr, hours.endTime).utc.getTime();
    if (opens > span.start.getTime() || closes < span.end.getTime()) continue;
    const busy = ctx.busyByStylist.get(otherId) ?? [];
    const taken = busy.some((interval) => {
      const busyStart = interval.start.getTime();
      return busyStart < span.end.getTime() && span.start.getTime() < busyStart + interval.durationMin * 60_000;
    });
    if (!taken) free += 1;
  }
  return needed <= free ? { allowed: true } : { allowed: false, needed, free, start: span.start, end: span.end };
}

export function diaryChairAllows(ctx: ChairContext | null, stylistId: string, start: Date, durationMin: number): boolean {
  return checkDiaryChair(ctx, stylistId, start, durationMin).allowed;
}
