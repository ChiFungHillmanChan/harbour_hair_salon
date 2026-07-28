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

export type AppointmentWithDetails = {
  id: string;
  date: Date;
  user: { email: string; name: string | null };
  stylist: { name: string };
  service: { name: string; price: number; duration: number };
};

interface AppointmentReminderProps {
  appointment: AppointmentWithDetails;
}

const BRAND = '#18181b';
const SALON_ADDRESS = 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';
import { formatSalonDate, formatSalonTime, salonRelativeDay } from '@/app/services/salon-time';

export function AppointmentReminder({ appointment }: AppointmentReminderProps) {
  const dateFormatted = formatSalonDate(appointment.date);
  const timeFormatted = formatSalonTime(appointment.date);
  // The reminder cron scans a 36h window, so a picked-up appointment can be
  // today rather than tomorrow — say the right word instead of always "tomorrow".
  const when = salonRelativeDay(appointment.date) ?? 'soon';

  return (
    <Html>
      <Head />
      <Preview>Reminder: your appointment is {when} — {appointment.service.name} at {timeFormatted}</Preview>
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'Georgia, serif', margin: 0, padding: '32px 0' }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e4e4e7' }}>
          {/* Header */}
          <Section style={{ backgroundColor: BRAND, padding: '32px 40px' }}>
            <Text style={{ color: '#ffffff', fontSize: '22px', fontWeight: 'bold', margin: 0, letterSpacing: '0.05em' }}>
              Harbour Hair Salon
            </Text>
            <Text style={{ color: '#a1a1aa', fontSize: '13px', margin: '4px 0 0' }}>
              {SALON_ADDRESS}
            </Text>
          </Section>

          {/* Body */}
          <Section style={{ padding: '40px 40px 24px' }}>
            <Text style={{ fontSize: '24px', fontWeight: 'bold', color: '#18181b', margin: '0 0 8px' }}>
              {when === 'today' ? 'See You Today!' : 'See You Tomorrow!'}
            </Text>
            <Text style={{ fontSize: '15px', color: '#52525b', margin: '0 0 24px', lineHeight: '1.6' }}>
              Hi {appointment.user.name || 'there'}, this is a friendly reminder about your appointment {when}.
            </Text>

            <Hr style={{ borderColor: '#e4e4e7', margin: '0 0 24px' }} />

            {/* Appointment Details */}
            <Section style={{ backgroundColor: '#f8fafc', borderRadius: '8px', padding: '20px 24px', marginBottom: '24px' }}>
              <Row label="Service" value={appointment.service.name} />
              <Row label="Stylist" value={appointment.stylist.name} />
              <Row label="Date" value={dateFormatted} />
              <Row label="Time" value={timeFormatted} />
              <Row label="Duration" value={`${appointment.service.duration} minutes`} last />
            </Section>

            {/* Address */}
            <Section style={{ backgroundColor: '#faf7f0', borderRadius: '8px', padding: '16px 20px', marginBottom: '24px', border: `1px solid #e8dcc4` }}>
              <Text style={{ fontSize: '11px', color: BRAND, fontWeight: 'bold', margin: '0 0 6px', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'sans-serif' }}>
                Location
              </Text>
              <Text style={{ fontSize: '14px', color: '#3f3f46', margin: 0, fontFamily: 'sans-serif', lineHeight: '1.5' }}>
                {SALON_ADDRESS}
              </Text>
            </Section>

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
              Manage Booking
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
