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

interface PasswordResetProps {
  name: string | null;
  /** Raw (unhashed) token — only ever exists in transit and in this email. */
  token: string;
  /** Link lifetime in minutes, shown to the reader. */
  expiresInMinutes: number;
}

const INK = '#18181B';
const MUTED = '#52525B';
const LINE = '#E4E4E7';
const SURFACE = '#FAFAFA';

export function PasswordReset({ name, token, expiresInMinutes }: PasswordResetProps) {
  const resetUrl = `${BASE_URL}/auth/reset-password?token=${encodeURIComponent(token)}`;

  return (
    <Html lang="en">
      <Head />
      <Preview>Reset your Harbour Hair Salon password</Preview>
      <Body style={{ backgroundColor: '#F4F4F5', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '28px 12px' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '14px', overflow: 'hidden', border: `1px solid ${LINE}` }}>
          <Section style={{ backgroundColor: INK, padding: '34px 36px 30px', textAlign: 'center' }}>
            <Text style={{ color: '#ffffff', fontFamily: 'Georgia, Times, serif', fontSize: '28px', fontWeight: 'bold', margin: 0, letterSpacing: '0.08em' }}>
              HARBOUR HAIR
            </Text>
            <Text style={{ color: '#A1A1AA', fontSize: '11px', margin: '7px 0 0', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
              Leeds City Centre
            </Text>
          </Section>

          <Section style={{ padding: '36px 36px 18px' }}>
            <Text style={{ color: INK, fontFamily: 'Georgia, Times, serif', fontSize: '26px', fontWeight: 'bold', lineHeight: '1.3', margin: '0 0 14px' }}>
              Reset your password
            </Text>
            <Text style={{ color: MUTED, fontSize: '15px', lineHeight: '1.7', margin: '0 0 26px' }}>
              Hi {name || 'there'}, we received a request to reset the password for your Harbour Hair
              Salon account. Click the button below to choose a new one.
            </Text>

            <Section style={{ textAlign: 'center', marginBottom: '26px' }}>
              <Link
                href={resetUrl}
                style={{
                  display: 'inline-block',
                  backgroundColor: INK,
                  borderRadius: '7px',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  letterSpacing: '0.09em',
                  padding: '14px 32px',
                  textDecoration: 'none',
                  textTransform: 'uppercase',
                }}
              >
                Choose a new password
              </Link>
            </Section>

            <Section style={{ backgroundColor: SURFACE, border: `1px solid ${LINE}`, borderRadius: '8px', padding: '14px 18px', marginBottom: '24px' }}>
              <Text style={{ color: MUTED, fontSize: '12px', lineHeight: '1.6', margin: '0 0 6px' }}>
                This link expires in {expiresInMinutes} minutes and can only be used once.
              </Text>
              <Text style={{ color: MUTED, fontSize: '12px', lineHeight: '1.6', margin: 0, wordBreak: 'break-all' }}>
                If the button does not work, paste this into your browser:<br />
                {resetUrl}
              </Text>
            </Section>

            <Hr style={{ borderColor: LINE, margin: '0 0 18px' }} />
            <Text style={{ color: MUTED, fontSize: '12px', lineHeight: '1.65', margin: 0 }}>
              <strong style={{ color: INK }}>Didn&apos;t request this?</strong> You can safely ignore
              this email — your password will not change until someone uses the link above. Resetting
              your password will sign you out on all devices.
            </Text>
          </Section>

          <Section style={{ backgroundColor: INK, padding: '20px 36px', textAlign: 'center' }}>
            <Text style={{ color: '#71717A', fontSize: '11px', lineHeight: '1.6', margin: 0 }}>
              Harbour Hair Salon · Leeds
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
