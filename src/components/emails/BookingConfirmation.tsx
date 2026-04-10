import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Hr,
  Preview,
} from '@react-email/components';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';

export type AppointmentWithDetails = {
  id: string;
  date: Date;
  user: { email: string; name: string | null };
  stylist: { name: string };
  service: { name: string; price: number; duration: number };
};

interface BookingConfirmationProps {
  appointment: AppointmentWithDetails;
}

const BRAND = '#174F7F';
const SALON_ADDRESS = 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX';

export function BookingConfirmation({ appointment }: BookingConfirmationProps) {
  const dateFormatted = appointment.date.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeFormatted = appointment.date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Html>
      <Head />
      <Preview>Your booking is confirmed — {appointment.service.name} on {dateFormatted}</Preview>
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'Georgia, serif', margin: 0, padding: '32px 0' }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e4e4e7' }}>
          {/* Header */}
          <Section style={{ backgroundColor: BRAND, padding: '32px 40px' }}>
            <Text style={{ color: '#ffffff', fontSize: '22px', fontWeight: 'bold', margin: 0, letterSpacing: '0.05em' }}>
              Harbour Hair Salon
            </Text>
            <Text style={{ color: '#bfdbfe', fontSize: '13px', margin: '4px 0 0' }}>
              {SALON_ADDRESS}
            </Text>
          </Section>

          {/* Body */}
          <Section style={{ padding: '40px 40px 24px' }}>
            <Text style={{ fontSize: '24px', fontWeight: 'bold', color: '#18181b', margin: '0 0 8px' }}>
              Booking Confirmed
            </Text>
            <Text style={{ fontSize: '15px', color: '#52525b', margin: '0 0 24px', lineHeight: '1.6' }}>
              Hi {appointment.user.name || 'there'}, your appointment has been confirmed. We look forward to seeing you!
            </Text>

            <Hr style={{ borderColor: '#e4e4e7', margin: '0 0 24px' }} />

            {/* Appointment Details */}
            <Section style={{ backgroundColor: '#f8fafc', borderRadius: '8px', padding: '20px 24px', marginBottom: '24px' }}>
              <Row label="Service" value={appointment.service.name} />
              <Row label="Stylist" value={appointment.stylist.name} />
              <Row label="Date" value={dateFormatted} />
              <Row label="Time" value={timeFormatted} />
              <Row label="Duration" value={`${appointment.service.duration} minutes`} />
              <Row label="Price" value={`£${appointment.service.price.toFixed(2)}`} last />
            </Section>

            {/* Address */}
            <Text style={{ fontSize: '13px', color: '#71717a', margin: '0 0 24px', lineHeight: '1.5' }}>
              <strong style={{ color: '#3f3f46' }}>Location:</strong> {SALON_ADDRESS}
            </Text>

            <Hr style={{ borderColor: '#e4e4e7', margin: '0 0 24px' }} />

            {/* CTA */}
            <Link
              href={`${BASE_URL}/appointments`}
              style={{
                display: 'inline-block',
                backgroundColor: BRAND,
                color: '#ffffff',
                padding: '12px 28px',
                borderRadius: '6px',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: 'bold',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              View My Bookings
            </Link>
          </Section>

          {/* Footer */}
          <Section style={{ backgroundColor: '#f4f4f5', padding: '20px 40px', borderTop: '1px solid #e4e4e7' }}>
            <Text style={{ fontSize: '12px', color: '#a1a1aa', margin: 0, lineHeight: '1.5' }}>
              Harbour Hair Salon · {SALON_ADDRESS}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: last ? 0 : '12px' }}>
      <Text style={{ fontSize: '13px', color: '#71717a', margin: 0, fontFamily: 'sans-serif' }}>{label}</Text>
      <Text style={{ fontSize: '13px', color: '#18181b', fontWeight: 'bold', margin: 0, fontFamily: 'sans-serif' }}>{value}</Text>
    </div>
  );
}
