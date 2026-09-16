import { formatSalonTime } from '@/app/services/salon-time';
import type { MoveClash } from '@/app/services/admin-move-clashes';

/**
 * Describe a clash in the words an admin needs to make the call.
 *
 * Shared by the day grid, the week grid and the booking dialog so all three
 * name the same conflict identically — the salon reads one of these while
 * deciding whether to override, and a drag and a typed booking must not
 * describe the same collision in different words.
 */
export function describeClash(clash: MoveClash): string {
  switch (clash.kind) {
    case 'OVERLAP':
      return `Overlaps ${clash.customerName ?? 'another booking'} at ${formatSalonTime(new Date(clash.start))}`;
    case 'OUTSIDE_HOURS':
      return clash.availability
        ? `Outside working hours (${clash.availability.startTime}–${clash.availability.endTime})`
        : 'This stylist does not work on this day';
    case 'EXTERNAL_BUSY':
      return `Clashes with synced busy time at ${formatSalonTime(new Date(clash.start))}`;
    case 'PATCH_TEST':
      return clash.reason === 'expired'
        ? 'The customer’s patch test has expired for this date'
        : clash.reason === 'too_soon'
          ? 'The patch test is less than 48 hours before this date'
          : 'No completed patch test on file for this colour service';
  }
}
