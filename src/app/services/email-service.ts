import 'server-only';
import { Resend } from 'resend';
import { BookingConfirmation } from '@/components/emails/BookingConfirmation';
import { BookingCancellation } from '@/components/emails/BookingCancellation';
import { BookingReschedule } from '@/components/emails/BookingReschedule';
import { AppointmentReminder } from '@/components/emails/AppointmentReminder';
import { ReviewRequest, type ReviewRequestAppointment } from '@/components/emails/ReviewRequest';
import { NewsletterWelcome } from '@/components/emails/NewsletterWelcome';

export type AppointmentWithDetails = {
  id: string;
  date: Date;
  user: { email: string; name: string | null };
  stylist: { name: string };
  service: { name: string; price: number; duration: number };
};

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is required');
  return new Resend(apiKey);
}

const FROM = 'Harbour Hair Salon <onboarding@resend.dev>';

export async function sendBookingConfirmation(appointment: AppointmentWithDetails): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: appointment.user.email,
      subject: 'Your booking is confirmed — Harbour Hair Salon',
      react: BookingConfirmation({ appointment }),
    });
  } catch (error) {
    console.error('Failed to send booking confirmation email:', error);
  }
}

export async function sendBookingCancellation(appointment: AppointmentWithDetails): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: appointment.user.email,
      subject: 'Your booking has been cancelled — Harbour Hair Salon',
      react: BookingCancellation({ appointment }),
    });
  } catch (error) {
    console.error('Failed to send booking cancellation email:', error);
  }
}

export async function sendBookingReschedule(
  appointment: AppointmentWithDetails,
  oldDate: Date
): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: appointment.user.email,
      subject: 'Your booking has been rescheduled — Harbour Hair Salon',
      react: BookingReschedule({ appointment, oldDate }),
    });
  } catch (error) {
    console.error('Failed to send booking reschedule email:', error);
  }
}

export async function sendAppointmentReminder(appointment: AppointmentWithDetails): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: appointment.user.email,
      subject: 'Reminder: your appointment is tomorrow — Harbour Hair Salon',
      react: AppointmentReminder({ appointment }),
    });
  } catch (error) {
    console.error('Failed to send appointment reminder email:', error);
  }
}

export async function sendReviewRequest(appointment: ReviewRequestAppointment): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: appointment.user.email,
      subject: 'How was your visit? — Harbour Hair Salon',
      react: ReviewRequest({ appointment }),
    });
  } catch (error) {
    console.error('Failed to send review request email:', error);
  }
}

export async function sendNewsletterWelcome(email: string): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Welcome to Harbour Hair Salon',
      react: NewsletterWelcome(),
    });
  } catch (error) {
    console.error('Failed to send newsletter welcome email:', error);
  }
}
