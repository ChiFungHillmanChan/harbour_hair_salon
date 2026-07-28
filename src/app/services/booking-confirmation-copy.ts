import type { AppointmentWithDetails } from '@/components/emails/BookingConfirmation';
import { formatSalonDate, formatSalonTime } from '@/app/services/salon-time';

export function buildBookingConfirmationText(appointment: AppointmentWithDetails): string {
  const date = formatSalonDate(appointment.date);
  const time = formatSalonTime(appointment.date);
  const reference = appointment.id.slice(-8).toUpperCase();

  return [
    'HARBOUR HAIR — BOOKING CONFIRMED',
    '',
    `Hi ${appointment.user.name || 'there'},`,
    '',
    'Your appointment at Harbour Hair Salon is confirmed.',
    '',
    `Service: ${appointment.service.name}`,
    `Stylist: ${appointment.stylist.name}`,
    `Date: ${date}`,
    `Time: ${time}`,
    `Duration: ${appointment.service.duration} minutes`,
    `Price: £${appointment.service.price.toFixed(2)}`,
    `Booking reference: ${reference}`,
    '',
    'Location: Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX',
    'Manage your booking up to 24 hours before the appointment from the My Bookings page.',
  ].join('\n');
}
