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

export type RequestReceivedAppointment = {
  id: string;
  date: Date;
  user: { email: string; name: string | null };
  stylist: { name: string };
  service: { name: string; price: number; duration: number };
};

interface BookingRequestReceivedProps {
  appointment: RequestReceivedAppointment;
  salonPhone: string;
}

// Monochrome palette, matching the live site brand.
const INK = '#18181B';
const MUTED = '#52525B';
const LINE = '#E4E4E7';
const SURFACE = '#FAFAFA';
const SALON_ADDRESS = 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX';

/**
 * Sent the moment a customer submits a booking REQUEST.
 *
 * Bookings are created as PENDING and only become CONFIRMED when the salon
 * approves them, so without this email the customer got total silence between
 * submitting and approval and had no idea the request had landed.
 * It deliberately does NOT say "confirmed" — BookingConfirmation covers that.
 */
export function BookingRequestReceived({ appointment, salonPhone }: BookingRequestReceivedProps) {
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
      <Preview>
        We&apos;ve received your request — {appointment.service.name} on {dateFormatted}
      </Preview>
      <Body style={{ backgroundColor: '#F4F4F5', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '28px 12px' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '14px', overflow: 'hidden', border: `1px solid ${LINE}` }}>
          <Section style={{ backgroundColor: INK, padding: '34px 36px 30px', textAlign: 'center' }}>
            <Text style={{ color: '#ffffff', fontFamily: 'Georgia, Times, serif', fontSize: '28px', fontWeight: 'bold', margin: 0, letterSpacing: '0.08em' }}>
              HARBOUR HAIR
            </Text>
            <Text style={{ color: '#A1A1AA', fontSize: '11px', margin: '7px 0 0', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
              Leeds City Centre
            </Text>
            <Hr style={{ borderColor: '#52525B', borderWidth: '2px 0 0', margin: '22px auto 0', width: '52px' }} />
          </Section>

          <Section style={{ padding: '38px 36px 18px' }}>
            <Text style={{ color: MUTED, fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.16em', margin: '0 0 10px', textTransform: 'uppercase' }}>
              Request received
            </Text>
            <Text style={{ color: INK, fontFamily: 'Georgia, Times, serif', fontSize: '29px', fontWeight: 'bold', lineHeight: '1.25', margin: '0 0 14px' }}>
              Thanks — we&apos;ve got your request.
            </Text>
            <Text style={{ color: MUTED, fontSize: '15px', lineHeight: '1.7', margin: '0 0 26px' }}>
              Hi {appointment.user.name || 'there'}, we&apos;ve received your booking request and the
              salon will confirm it shortly. <strong style={{ color: INK }}>This is not a confirmation yet</strong> —
              you&apos;ll get a separate email once your appointment is confirmed.
            </Text>

            <Section style={{ backgroundColor: SURFACE, border: `1px solid ${LINE}`, borderRadius: '10px', padding: '8px 22px', marginBottom: '24px' }}>
              <DetailRow label="Service" value={appointment.service.name} />
              <DetailRow label="Stylist" value={appointment.stylist.name} />
              <DetailRow label="Requested date" value={dateFormatted} />
              <DetailRow label="Requested time" value={timeFormatted} />
              <DetailRow label="Duration" value={`${appointment.service.duration} minutes`} />
              <DetailRow label="Price" value={`£${appointment.service.price.toFixed(2)}`} last />
            </Section>

            <Section style={{ borderLeft: `4px solid ${INK}`, backgroundColor: SURFACE, padding: '14px 18px', marginBottom: '26px' }}>
              <Text style={{ color: INK, fontSize: '13px', fontWeight: 'bold', margin: '0 0 4px' }}>Need it sooner?</Text>
              <Text style={{ color: MUTED, fontSize: '13px', lineHeight: '1.55', margin: 0 }}>
                Call the salon on {salonPhone} and we&apos;ll sort it out straight away.
              </Text>
            </Section>

            <Section style={{ textAlign: 'center', marginBottom: '28px' }}>
              <Link
                href={`${BASE_URL}/appointments`}
                style={{
                  display: 'inline-block',
                  backgroundColor: INK,
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
                View my request
              </Link>
            </Section>

            <Hr style={{ borderColor: LINE, margin: '0 0 20px' }} />
            <Text style={{ color: MUTED, fontSize: '12px', lineHeight: '1.65', margin: 0 }}>
              You can withdraw this request at any time from My Bookings. Payment is due at the
              salon; cash and card are accepted.
            </Text>
          </Section>

          <Section style={{ backgroundColor: INK, padding: '22px 36px', textAlign: 'center' }}>
            <Text style={{ color: '#A1A1AA', fontSize: '11px', lineHeight: '1.6', margin: '0 0 5px' }}>
              Reference: <strong style={{ color: '#ffffff' }}>{bookingReference}</strong>
            </Text>
            <Text style={{ color: '#71717A', fontSize: '11px', lineHeight: '1.6', margin: 0 }}>
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
    <Row style={{ borderBottom: last ? 'none' : `1px solid ${LINE}` }}>
      <Column style={{ padding: '12px 0', width: '38%' }}>
        <Text style={{ color: MUTED, fontSize: '12px', margin: 0 }}>{label}</Text>
      </Column>
      <Column style={{ padding: '12px 0', textAlign: 'right' }}>
        <Text style={{ color: INK, fontSize: '13px', fontWeight: 'bold', margin: 0 }}>{value}</Text>
      </Column>
    </Row>
  );
}
