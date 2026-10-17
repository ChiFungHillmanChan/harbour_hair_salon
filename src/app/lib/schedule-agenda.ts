import { salonMinutesOfDay } from '@/app/services/salon-time';
import type { PlacedDiaryEntry } from './calendar-diary-display';

/** Filter only the visible diary; attention queues and totals remain global. */
export function filterScheduleForStylist<A extends { stylistId: string }, B extends { stylistId: string }, D extends { stylistIds: string[] }>(appointments: A[], busy: B[], diary: D[], stylistId: string) {
  return {
    appointments: stylistId ? appointments.filter(row => row.stylistId === stylistId) : appointments,
    busy: stylistId ? busy.filter(row => row.stylistId === stylistId) : busy,
    diary: stylistId ? diary.filter(row => row.stylistIds.includes(stylistId)) : diary,
  };
}

/** Retain source identity and the original objects: no cross-source matching or deduplication. */
export function scheduleAgenda<A extends { id: string; date: string | Date }, B extends { id: string; startMin: number; allDay?: boolean }>(appointments: A[], busy: B[], diary: PlacedDiaryEntry[]) {
  type Row = { source: 'website'; value: A; startMin: number } | { source: 'busy'; value: B; startMin: number } | { source: 'google'; value: PlacedDiaryEntry; startMin: number };
  const timed: Row[] = [
    ...appointments.map(value => ({ source: 'website' as const, value, startMin: salonMinutesOfDay(new Date(value.date)) })),
    ...busy.filter(value => !value.allDay).map(value => ({ source: 'busy' as const, value, startMin: value.startMin })),
    ...diary.filter(value => !value.allDay && value.kind !== 'NOTE').map(value => ({ source: 'google' as const, value, startMin: value.startMin })),
  ];
  return {
    timed: timed.sort((a, b) => a.startMin - b.startMin),
    allDayBusy: busy.filter(value => value.allDay),
    notes: diary.filter(value => value.allDay || value.kind === 'NOTE').sort((a, b) => a.startMin - b.startMin),
  };
}

/** Use the classifier's explicit ids, never names guessed from a private diary title. */
export function diaryStylistNames(entry: { stylistIds: string[] }, stylists: { id: string; name: string }[]): string[] {
  return entry.stylistIds.flatMap(id => {
    const stylist = stylists.find(row => row.id === id);
    return stylist ? [stylist.name] : [];
  });
}
