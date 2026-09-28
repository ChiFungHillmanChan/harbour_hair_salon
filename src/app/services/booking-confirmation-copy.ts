import type { Locale } from '@/i18n/config';
import { appointmentEmailContent, renderPlainText, toEmailAppointment, type EmailAppointment, type LegacyEmailAppointment } from './email-content';

/** Plain-text confirmation, identical in wording to the HTML confirmation email. */
export function buildBookingConfirmationText(appointment: EmailAppointment | LegacyEmailAppointment, locale: Locale = 'en-GB'): string {
  return renderPlainText(appointmentEmailContent('CONFIRMATION', toEmailAppointment(appointment), locale));
}
