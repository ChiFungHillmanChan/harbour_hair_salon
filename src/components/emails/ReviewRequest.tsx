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

export type ReviewRequestAppointment = {
  id: string;
  date: Date;
  user: { email: string; name: string | null };
  stylist: { name: string };
  service: { name: string };
};

interface ReviewRequestProps {
  appointment: ReviewRequestAppointment;
}

const BRAND = '#18181b';
const ACCENT = '#c9a96e';
const SALON_ADDRESS = 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';

export function ReviewRequest({ appointment }: ReviewRequestProps) {
  const dateFormatted = appointment.date.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const reviewUrl = `${BASE_URL}/reviews/new?appointmentId=${appointment.id}`;

  return (
    <Html>
      <Head />
      <Preview>How was your visit to Harbour Hair Salon?</Preview>
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'Georgia, serif', margin: 0, padding: '32px 0' }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e4e4e7' }}>
          <Section style={{ backgroundColor: BRAND, padding: '32px 40px' }}>
            <Text style={{ color: '#ffffff', fontSize: '22px', fontWeight: 'bold', margin: 0, letterSpacing: '0.05em' }}>
              Harbour Hair Salon
            </Text>
            <Text style={{ color: '#D4C5A0', fontSize: '13px', margin: '4px 0 0' }}>
              {SALON_ADDRESS}
            </Text>
          </Section>

          <Section style={{ padding: '40px 40px 24px' }}>
            <Text style={{ fontSize: '24px', fontWeight: 'bold', color: '#18181b', margin: '0 0 8px' }}>
              How was your visit?
            </Text>
            <Text style={{ fontSize: '15px', color: '#52525b', margin: '0 0 24px', lineHeight: '1.6' }}>
              Hi {appointment.user.name || 'there'}, thank you for choosing Harbour Hair Salon. We hope you love your new look from your recent {appointment.service.name.toLowerCase()} with {appointment.stylist.name}.
            </Text>

            <Text style={{ fontSize: '15px', color: '#52525b', margin: '0 0 24px', lineHeight: '1.6' }}>
              Your feedback helps us improve and helps other clients in Leeds find the right stylist. It only takes a minute.
            </Text>

            <Hr style={{ borderColor: '#e4e4e7', margin: '0 0 24px' }} />

            <Section style={{ backgroundColor: '#f8fafc', borderRadius: '8px', padding: '20px 24px', marginBottom: '24px' }}>
              <Row label="Service" value={appointment.service.name} />
              <Row label="Stylist" value={appointment.stylist.name} />
              <Row label="Date" value={dateFormatted} last />
            </Section>

            <Link
              href={reviewUrl}
              style={{
                display: 'inline-block',
                backgroundColor: ACCENT,
                color: '#000000',
                padding: '14px 32px',
                borderRadius: '6px',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: 'bold',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              Leave a Review
            </Link>

            <Text style={{ fontSize: '13px', color: '#a1a1aa', margin: '24px 0 0', lineHeight: '1.5' }}>
              If the button doesn&apos;t work, copy this link into your browser:{' '}
              <Link href={reviewUrl} style={{ color: BRAND }}>
                {reviewUrl}
              </Link>
            </Text>
          </Section>

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
