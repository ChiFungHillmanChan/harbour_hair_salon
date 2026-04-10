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

const BRAND = '#174F7F';
const ACCENT = '#c9a96e';
const SALON_ADDRESS = 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';

export function NewsletterWelcome() {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Harbour Hair Salon — you&apos;re on the list.</Preview>
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'Georgia, serif', margin: 0, padding: '32px 0' }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e4e4e7' }}>
          <Section style={{ backgroundColor: BRAND, padding: '32px 40px' }}>
            <Text style={{ color: '#ffffff', fontSize: '22px', fontWeight: 'bold', margin: 0, letterSpacing: '0.05em' }}>
              Harbour Hair Salon
            </Text>
            <Text style={{ color: '#bfdbfe', fontSize: '13px', margin: '4px 0 0' }}>
              {SALON_ADDRESS}
            </Text>
          </Section>

          <Section style={{ padding: '40px 40px 24px' }}>
            <Text style={{ fontSize: '24px', fontWeight: 'bold', color: '#18181b', margin: '0 0 8px' }}>
              You&apos;re on the list.
            </Text>
            <Text style={{ fontSize: '15px', color: '#52525b', margin: '0 0 20px', lineHeight: '1.6' }}>
              Thanks for subscribing. You&apos;ll be the first to hear about our seasonal offers,
              new services and the occasional tip from our Hong Kong trained stylists.
            </Text>
            <Text style={{ fontSize: '15px', color: '#52525b', margin: '0 0 28px', lineHeight: '1.6' }}>
              We&apos;ll keep it rare and useful — no spam, unsubscribe any time.
            </Text>

            <Hr style={{ borderColor: '#e4e4e7', margin: '0 0 24px' }} />

            <Link
              href={`${BASE_URL}/book`}
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
              Book an Appointment
            </Link>

            <Text style={{ fontSize: '13px', color: '#a1a1aa', margin: '28px 0 0', lineHeight: '1.5' }}>
              Visit us at {SALON_ADDRESS}, or call{' '}
              <Link href="tel:+447831830898" style={{ color: BRAND }}>
                07831 830898
              </Link>
              .
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
