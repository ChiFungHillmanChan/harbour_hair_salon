import type { Locale } from '@/i18n/config';
import { translator } from '@/i18n/messages';
import { localizeHref } from '@/i18n/paths';
import { SITE_URL } from '@/app/lib/site-url';
import { appointmentCalendarUid, type AppointmentCalendarEvent } from '@/app/lib/calendar-links';
import { salonDateKey } from './salon-time';

/**
 * A customer's appointment as an entry for their own calendar, in one
 * language: "<service> at Harbour Hair Salon", the stylist and a link to My
 * Bookings, at the salon's address. The emails (Google link + attached .ics)
 * and My Bookings (Google link + .ics made in the browser) both use it, so they
 * say the same thing. Built from data the caller already holds — no query.
 */
export function appointmentCalendarEvent(appointment: {
  id: string;
  date: Date;
  durationMinutes: number;
  /** Already in `locale` where a published translation exists. */
  serviceName: string;
  stylistName: string;
  /** The appointment's notificationVersion: the entry's SEQUENCE. */
  sequence: number;
}, locale: Locale): AppointmentCalendarEvent {
  const t = translator(locale, 'emails');
  const url = `${SITE_URL}${localizeHref(locale, '/appointments')}`;
  return {
    uid: appointmentCalendarUid(appointment.id),
    sequence: appointment.sequence,
    start: appointment.date.toISOString(),
    end: new Date(appointment.date.getTime() + appointment.durationMinutes * 60_000).toISOString(),
    title: t('calendar.title', { service: appointment.serviceName }),
    details: t('calendar.details', { stylist: appointment.stylistName, url }),
    location: t('common.address'),
    url,
    // The salon's date of the visit, so several downloads are easy to tell apart.
    filename: `harbour-hair-${salonDateKey(appointment.date)}.ics`,
  };
}
