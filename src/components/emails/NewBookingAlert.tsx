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

export type NewBookingAlertAppointment = {
  id: string;
  date: Date;
  notes: string | null;
  user: { email: string; name: string | null; phone: string | null };
  stylist: { name: string };
  service: { name: string; price: number; duration: number };
};

interface NewBookingAlertProps {
  appointment: NewBookingAlertAppointment;
}

const INK = '#18181B';
const MUTED = '#52525B';
const LINE = '#E4E4E7';
const SURFACE = '#FAFAFA';

/**
 * Internal staff alert — sent to the salon when a customer submits a request.
 *
 * The double-confirm flow means a PENDING request does nothing until an admin
 * approves it. Previously nobody was told a request had arrived, so it sat
 * unactioned until someone happened to open the admin dashboard.
 *
 * Goes only to the salon's own address, so it may contain customer contact
 * details (the customer-facing templates deliberately do not).
 */
export function NewBookingAlert({ appointment }: NewBookingAlertProps) {
  const dateFormatted = appointment.date.toLocaleDateString('en-GB', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeFormatted = appointment.date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const bookingReference = appointment.id.slice(-8).toUpperCase();
  const customerName = appointment.user.name || 'Name not given';

  return (
    <Html lang="en">
      <Head />
      <Preview>
        Action needed: {customerName} requested {appointment.service.name} on {dateFormatted} at {timeFormatted}
      </Preview>
      <Body style={{ backgroundColor: '#F4F4F5', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '28px 12px' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '14px', overflow: 'hidden', border: `1px solid ${LINE}` }}>
          <Section style={{ backgroundColor: INK, padding: '26px 36px', textAlign: 'center' }}>
            <Text style={{ color: '#ffffff', fontSize: '13px', fontWeight: 'bold', margin: 0, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              New booking request
            </Text>
          </Section>

          <Section style={{ padding: '30px 36px 18px' }}>
            <Text style={{ color: INK, fontFamily: 'Georgia, Times, serif', fontSize: '24px', fontWeight: 'bold', lineHeight: '1.3', margin: '0 0 8px' }}>
              {customerName} wants {appointment.service.name}
            </Text>
            <Text style={{ color: MUTED, fontSize: '14px', lineHeight: '1.6', margin: '0 0 24px' }}>
              This request is <strong style={{ color: INK }}>PENDING</strong> and the customer has not been
              confirmed yet. Approve or decline it in the admin schedule.
            </Text>

            <Section style={{ backgroundColor: SURFACE, border: `1px solid ${LINE}`, borderRadius: '10px', padding: '8px 22px', marginBottom: '24px' }}>
              <DetailRow label="Date" value={dateFormatted} />
              <DetailRow label="Time" value={timeFormatted} />
              <DetailRow label="Stylist" value={appointment.stylist.name} />
              <DetailRow label="Duration" value={`${appointment.service.duration} minutes`} />
              <DetailRow label="Price" value={`£${appointment.service.price.toFixed(2)}`} />
              <DetailRow label="Customer" value={customerName} />
              <DetailRow label="Email" value={appointment.user.email} />
              <DetailRow label="Phone" value={appointment.user.phone || 'Not provided'} last={!appointment.notes} />
              {appointment.notes ? <DetailRow label="Notes" value={appointment.notes} last /> : null}
            </Section>

            <Section style={{ textAlign: 'center', marginBottom: '26px' }}>
              <Link
                href={`${BASE_URL}/admin`}
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
                Open admin schedule
              </Link>
            </Section>

            <Hr style={{ borderColor: LINE, margin: '0 0 16px' }} />
            <Text style={{ color: MUTED, fontSize: '11px', lineHeight: '1.6', margin: 0 }}>
              Reference {bookingReference} · Internal staff notification — do not forward.
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
      <Column style={{ padding: '11px 0', width: '32%' }}>
        <Text style={{ color: MUTED, fontSize: '12px', margin: 0 }}>{label}</Text>
      </Column>
      <Column style={{ padding: '11px 0', textAlign: 'right' }}>
        <Text style={{ color: INK, fontSize: '13px', fontWeight: 'bold', margin: 0 }}>{value}</Text>
      </Column>
    </Row>
  );
}
