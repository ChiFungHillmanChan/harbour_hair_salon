export type ClockAction = { type: 'CLOCK_IN' } | { type: 'CLOCK_OUT'; entryId: string };

export function nextClockAction(openEntry: { id: string } | null): ClockAction {
  return openEntry ? { type: 'CLOCK_OUT', entryId: openEntry.id } : { type: 'CLOCK_IN' };
}
