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
  Row,
  Column,
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
const BRAND_DARK = '#103653';
const ACCENT = '#D8B36A';
const INK = '#17202A';
const MUTED = '#5F6B76';
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
  const bookingReference = appointment.id.slice(-8).toUpperCase();

  return (
    <Html lang="en">
      <Head />
      <Preview>Your Harbour Hair appointment is confirmed — {appointment.service.name} on {dateFormatted}</Preview>
      <Body style={{ backgroundColor: '#EEF3F7', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '28px 12px' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '14px', overflow: 'hidden', border: '1px solid #D9E3EA' }}>
          <Section style={{ backgroundColor: BRAND, padding: '34px 36px 30px', textAlign: 'center' }}>
            <Text style={{ color: '#ffffff', fontFamily: 'Georgia, Times, serif', fontSize: '28px', fontWeight: 'bold', margin: 0, letterSpacing: '0.08em' }}>
              HARBOUR HAIR
            </Text>
            <Text style={{ color: '#D8E7F2', fontSize: '11px', margin: '7px 0 0', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
              Leeds City Centre
            </Text>
            <Hr style={{ borderColor: ACCENT, borderWidth: '2px 0 0', margin: '22px auto 0', width: '52px' }} />
          </Section>

          <Section style={{ padding: '38px 36px 18px' }}>
            <Text style={{ color: BRAND, fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.16em', margin: '0 0 10px', textTransform: 'uppercase' }}>
              Booking confirmed
            </Text>
            <Text style={{ color: INK, fontFamily: 'Georgia, Times, serif', fontSize: '29px', fontWeight: 'bold', lineHeight: '1.25', margin: '0 0 14px' }}>
              We&apos;re looking forward to seeing you.
            </Text>
            <Text style={{ color: MUTED, fontSize: '15px', lineHeight: '1.7', margin: '0 0 26px' }}>
              Hi {appointment.user.name || 'there'}, your appointment at Harbour Hair Salon is safely booked. Keep this email for your appointment details.
            </Text>

            <Section style={{ backgroundColor: '#F5F9FC', border: '1px solid #D7E5EF', borderRadius: '10px', padding: '8px 22px', marginBottom: '24px' }}>
              <DetailRow label="Service" value={appointment.service.name} />
              <DetailRow label="Stylist" value={appointment.stylist.name} />
              <DetailRow label="Date" value={dateFormatted} />
              <DetailRow label="Time" value={timeFormatted} />
              <DetailRow label="Duration" value={`${appointment.service.duration} minutes`} />
              <DetailRow label="Price" value={`£${appointment.service.price.toFixed(2)}`} last />
            </Section>

            <Section style={{ borderLeft: `4px solid ${ACCENT}`, backgroundColor: '#FFF9ED', padding: '14px 18px', marginBottom: '26px' }}>
              <Text style={{ color: INK, fontSize: '13px', fontWeight: 'bold', margin: '0 0 4px' }}>Where to find us</Text>
              <Text style={{ color: MUTED, fontSize: '13px', lineHeight: '1.55', margin: 0 }}>{SALON_ADDRESS}</Text>
            </Section>

            <Section style={{ textAlign: 'center', marginBottom: '28px' }}>
              <Link
                href={`${BASE_URL}/appointments`}
                style={{
                  display: 'inline-block',
                  backgroundColor: BRAND,
                  borderRadius: '7px',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  letterSpacing: '0.09em',
                  padding: '14px 28px',
                  textDecoration: 'none',
                  textTransform: 'uppercase',
                }}
              >
                Manage my booking
              </Link>
            </Section>

            <Hr style={{ borderColor: '#E5E7EB', margin: '0 0 20px' }} />
            <Text style={{ color: MUTED, fontSize: '12px', lineHeight: '1.65', margin: 0 }}>
              Need to make a change? You can cancel or reschedule from My Bookings up to 24 hours before your appointment. Payment is due at the salon; cash and card are accepted.
            </Text>
          </Section>

          <Section style={{ backgroundColor: BRAND_DARK, padding: '22px 36px', textAlign: 'center' }}>
            <Text style={{ color: '#D8E7F2', fontSize: '11px', lineHeight: '1.6', margin: '0 0 5px' }}>
              Booking reference: <strong style={{ color: '#ffffff' }}>{bookingReference}</strong>
            </Text>
            <Text style={{ color: '#B9CAD7', fontSize: '11px', lineHeight: '1.6', margin: 0 }}>
              Harbour Hair Salon · {SALON_ADDRESS}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <Row style={{ borderBottom: last ? 'none' : '1px solid #DFE9F0' }}>
      <Column style={{ padding: '12px 0', width: '34%' }}>
        <Text style={{ color: MUTED, fontSize: '12px', margin: 0 }}>{label}</Text>
      </Column>
      <Column style={{ padding: '12px 0', textAlign: 'right' }}>
        <Text style={{ color: INK, fontSize: '13px', fontWeight: 'bold', margin: 0 }}>{value}</Text>
      </Column>
    </Row>
  );
}
