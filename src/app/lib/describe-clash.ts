import { formatSalonClock } from '@/i18n/dates';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages/types-client';
import type { MoveClash } from '@/app/services/admin-move-clashes';

/**
 * Describe a clash in the words an admin needs to make the call.
 *
 * Shared by the day grid, the week grid and the booking dialog so all three
 * name the same conflict identically — the salon reads one of these while
 * deciding whether to override, and a drag and a typed booking must not
 * describe the same collision in different words. The text follows the
 * admin's interface language; the customer's name stays as entered.
 */
export function describeClash(clash: MoveClash, t: Translate<Messages['adminSchedule']>): string {
  switch (clash.kind) {
    case 'OVERLAP': {
      const time = formatSalonClock(t.locale, new Date(clash.start));
      return clash.customerName
        ? t('clash.overlap', { customer: clash.customerName, time })
        : t('clash.overlapUnknown', { time });
    }
    case 'OUTSIDE_HOURS':
      return clash.availability
        ? t('clash.outsideHours', { start: clash.availability.startTime, end: clash.availability.endTime })
        : t('clash.dayOff');
    case 'EXTERNAL_BUSY':
      return t('clash.externalBusy', { time: formatSalonClock(t.locale, new Date(clash.start)) });
    case 'PATCH_TEST':
      return clash.reason === 'expired'
        ? t('clash.patchExpired')
        : clash.reason === 'too_soon'
          ? t('clash.patchTooSoon')
          : t('clash.patchMissing');
  }
}
