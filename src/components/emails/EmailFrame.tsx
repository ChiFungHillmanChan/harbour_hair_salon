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
import { HTML_LANG } from '@/i18n/config';
import { translator } from '@/i18n/messages';
import type { EmailContent } from '@/app/services/email-content';

const PALETTES = {
  // The monochrome salon look shared by every mail…
  ink: { header: '#18181B', headerMuted: '#A1A1AA', footer: '#18181B', footerMuted: '#71717A', accent: '#52525B', ink: '#18181B', muted: '#52525B', line: '#E4E4E7', surface: '#FAFAFA', page: '#F4F4F5', button: '#18181B' },
  // …except the confirmation, which keeps the colour scheme it already had.
  brand: { header: '#174F7F', headerMuted: '#D8E7F2', footer: '#103653', footerMuted: '#B9CAD7', accent: '#D8B36A', ink: '#17202A', muted: '#5F6B76', line: '#DFE9F0', surface: '#F5F9FC', page: '#EEF3F7', button: '#174F7F' },
} as const;

/**
 * One layout for every transactional mail, in either language. The words
 * come from services/email-content.ts (which also builds the plain-text part),
 * so HTML and text can never say different things.
 */
export function EmailFrame({ content }: { content: EmailContent }) {
  const c = PALETTES[content.palette];
  const t = translator(content.locale, 'emails');
  return (
    <Html lang={HTML_LANG[content.locale]}>
      <Head />
      <Preview>{content.preview}</Preview>
      <Body style={{ backgroundColor: c.page, fontFamily: 'Arial, Helvetica, "PingFang HK", "Microsoft JhengHei", sans-serif', margin: 0, padding: '28px 12px' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '14px', overflow: 'hidden', border: `1px solid ${c.line}` }}>
          <Section style={{ backgroundColor: c.header, padding: '34px 36px 30px', textAlign: 'center' }}>
            <Text style={{ color: '#ffffff', fontFamily: 'Georgia, Times, serif', fontSize: '28px', fontWeight: 'bold', margin: 0, letterSpacing: '0.08em' }}>
              {t('common.brand')}
            </Text>
            <Text style={{ color: c.headerMuted, fontSize: '11px', margin: '7px 0 0', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
              {t('common.tagline')}
            </Text>
            <Hr style={{ borderColor: c.accent, borderWidth: '2px 0 0', margin: '22px auto 0', width: '52px' }} />
          </Section>

          <Section style={{ padding: '38px 36px 18px' }}>
            <Text style={{ color: c.muted, fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.16em', margin: '0 0 10px', textTransform: 'uppercase' }}>
              {content.eyebrow}
            </Text>
            <Text style={{ color: c.ink, fontFamily: 'Georgia, Times, serif', fontSize: '29px', fontWeight: 'bold', lineHeight: '1.25', margin: '0 0 14px' }}>
              {content.title}
            </Text>
            <Text style={{ color: c.muted, fontSize: '15px', lineHeight: '1.7', margin: '0 0 26px' }}>
              {content.greeting ? <>{content.greeting} </> : null}{content.intro}
            </Text>

            {content.details.length > 0 && (
              <Section style={{ backgroundColor: c.surface, border: `1px solid ${c.line}`, borderRadius: '10px', padding: '8px 22px', marginBottom: '24px' }}>
                {content.details.map((row, index) => (
                  <Row key={`${row.label}-${index}`} style={{ borderBottom: index === content.details.length - 1 ? 'none' : `1px solid ${c.line}` }}>
                    <Column style={{ padding: '12px 0', width: '36%', verticalAlign: 'top' }}>
                      <Text style={{ color: c.muted, fontSize: '12px', margin: 0 }}>{row.label}</Text>
                    </Column>
                    <Column style={{ padding: '12px 0', textAlign: 'right' }}>
                      <Text style={{ color: c.ink, fontSize: '13px', fontWeight: 'bold', margin: 0, whiteSpace: 'pre-wrap' }}>{row.value}</Text>
                    </Column>
                  </Row>
                ))}
              </Section>
            )}

            {content.callout && (
              <Section style={{ borderLeft: `4px solid ${c.accent}`, backgroundColor: c.surface, padding: '14px 18px', marginBottom: '26px' }}>
                <Text style={{ color: c.ink, fontSize: '13px', fontWeight: 'bold', margin: '0 0 4px' }}>{content.callout.title}</Text>
                <Text style={{ color: c.muted, fontSize: '13px', lineHeight: '1.55', margin: 0 }}>{content.callout.body}</Text>
              </Section>
            )}

            {content.cta && (
              <Section style={{ textAlign: 'center', marginBottom: '28px' }}>
                <Link
                  href={content.cta.href}
                  style={{
                    display: 'inline-block',
                    backgroundColor: c.button,
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
                  {content.cta.label}
                </Link>
              </Section>
            )}

            {content.footnotes.length > 0 && <Hr style={{ borderColor: c.line, margin: '0 0 20px' }} />}
            {content.footnotes.map((note) => (
              <Text key={note} style={{ color: c.muted, fontSize: '12px', lineHeight: '1.65', margin: '0 0 8px' }}>
                {note}
              </Text>
            ))}
          </Section>

          <Section style={{ backgroundColor: c.footer, padding: '22px 36px', textAlign: 'center' }}>
            {content.reference && (
              <Text style={{ color: c.headerMuted, fontSize: '11px', lineHeight: '1.6', margin: '0 0 5px' }}>
                {content.reference}
              </Text>
            )}
            <Text style={{ color: c.footerMuted, fontSize: '11px', lineHeight: '1.6', margin: 0 }}>
              {t('common.salonName')} · {content.address}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
