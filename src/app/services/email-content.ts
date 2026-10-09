import type { Locale } from '@/i18n/config';
import { HTML_LANG } from '@/i18n/config';
import { translator } from '@/i18n/messages';
import { localizeHref } from '@/i18n/paths';
import { formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
import { SITE_URL } from '@/app/lib/site-url';
import { formatGBP, toPence } from './pricing/money';
import type { PriceNature, PriceType, VatDisplay } from './pricing/policy';
import { salonRelativeDay } from './salon-time';

/**
 * What an email may say about a booking's price. Built from the booking's own
 * frozen amount and quote (never today's price list). `known: false` is a
 * booking made before prices were recorded — the email says so instead of
 * inventing an amount.
 */
export type EmailPrice =
  | { known: true; amountPence: number; priceType: PriceType | null; vatDisplay: VatDisplay | null; priceNature: PriceNature | null }
  | { known: false };

export type EmailAppointment = {
  id: string;
  date: Date;
  user: { email: string; name: string | null; phone?: string | null };
  stylist: { name: string };
  service: { name: string; duration: number };
  price: EmailPrice;
  notes?: string | null;
};

/** Pre-quote callers and old queued events pass `service.price` as a number. */
export type LegacyEmailAppointment = Omit<EmailAppointment, 'price' | 'service'> & {
  service: { name: string; duration: number; price?: number };
  price?: EmailPrice;
};

export function toEmailAppointment(input: LegacyEmailAppointment | EmailAppointment): EmailAppointment {
  if ('price' in input && input.price) return { ...input, price: input.price } as EmailAppointment;
  const legacy = (input.service as { price?: unknown }).price;
  const price: EmailPrice = typeof legacy === 'number' && Number.isFinite(legacy)
    ? { known: true, amountPence: toPence(legacy), priceType: null, vatDisplay: null, priceNature: null }
    : { known: false };
  return { ...input, service: { name: input.service.name, duration: input.service.duration }, price };
}

export type AppointmentEmailKind = 'REQUEST_RECEIVED' | 'SALON_ALERT' | 'CONFIRMATION' | 'CANCELLATION' | 'RESCHEDULE' | 'REMINDER' | 'REVIEW_REQUEST'
  | 'RESCHEDULE_REQUEST_RECEIVED' | 'SALON_RESCHEDULE_ALERT' | 'RESCHEDULE_DECLINED' | 'RESCHEDULE_LAPSED';

/** Kinds addressed to the salon (its address and language), never the customer. */
export function isSalonEmailKind(kind: AppointmentEmailKind): boolean {
  return kind === 'SALON_ALERT' || kind === 'SALON_RESCHEDULE_ALERT';
}

/** Kinds that belong to one reschedule request (keyed by its `requestedAt`). */
export const RESCHEDULE_REQUEST_EMAIL_KINDS: readonly AppointmentEmailKind[] = ['RESCHEDULE_REQUEST_RECEIVED', 'SALON_RESCHEDULE_ALERT', 'RESCHEDULE_DECLINED', 'RESCHEDULE_LAPSED'];

export type EmailContent = {
  locale: Locale;
  /** 'brand' keeps the confirmation mail's existing colour scheme; everything else is monochrome. */
  palette: 'ink' | 'brand';
  subject: string;
  preview: string;
  eyebrow: string;
  title: string;
  greeting: string | null;
  intro: string;
  details: { label: string; value: string }[];
  callout?: { title: string; body: string };
  cta?: { label: string; href: string };
  footnotes: string[];
  reference?: string;
  address: string;
};

const url = (locale: Locale, path: string) => `${SITE_URL}${localizeHref(locale, path)}`;

/** "£157.00 · NHS price · VAT excluded" — only claims the quote supports. */
export function describeEmailPrice(price: EmailPrice, locale: Locale): string {
  const t = translator(locale, 'emails');
  if (!price.known) return t('values.unknownPrice');
  const parts = [formatGBP(price.amountPence, HTML_LANG[locale])];
  if (price.priceType === 'NHS') parts.push(t('values.nhsPrice'));
  if (price.vatDisplay === 'EXCLUDED') parts.push(t('values.vatExcluded'));
  if (price.priceNature === 'SUBJECT_TO_CONSULTATION') parts.push(t('values.subjectToConsultation'));
  return parts.join(' · ');
}

export type AppointmentEmailOptions = { salonPhone?: string; oldDate?: Date; requestedDate?: Date; now?: Date };

/** The words of every appointment email, in one language, from one place (HTML and plain text share them). */
export function appointmentEmailContent(
  kind: AppointmentEmailKind,
  appointment: EmailAppointment,
  locale: Locale,
  options: AppointmentEmailOptions = {},
): EmailContent {
  const t = translator(locale, 'emails');
  const date = formatSalonLongDate(locale, appointment.date);
  const time = formatSalonClock(locale, appointment.date);
  const reference = appointment.id.slice(-8).toUpperCase();
  const name = appointment.user.name?.trim();
  const greeting = name ? t('common.greeting', { name }) : t('common.greetingNoName');
  const service = appointment.service.name;
  const duration = t('values.minutes', { count: appointment.service.duration });
  const price = describeEmailPrice(appointment.price, locale);
  const base = { locale, palette: 'ink' as const, greeting, footnotes: [] as string[], reference: t('common.reference', { reference }), address: t('common.address') };
  const labels = (key: 'service' | 'stylist' | 'date' | 'time' | 'requestedDate' | 'requestedTime' | 'duration' | 'price' | 'previousDate' | 'currentTime', value: string) => ({ label: t(`labels.${key}`), value });

  switch (kind) {
    case 'CONFIRMATION':
      return {
        ...base, palette: 'brand',
        subject: t('confirmation.subject'),
        preview: t('confirmation.preview', { service, date }),
        eyebrow: t('confirmation.eyebrow'), title: t('confirmation.title'), intro: t('confirmation.intro'),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date), labels('time', time), labels('duration', duration), labels('price', price)],
        callout: { title: t('labels.whereToFind'), body: t('common.address') },
        cta: { label: t('confirmation.cta'), href: url(locale, '/appointments') },
        footnotes: [t('confirmation.footnote')],
      };
    case 'REQUEST_RECEIVED':
      return {
        ...base,
        subject: t('request.subject'),
        preview: t('request.preview', { service, date }),
        eyebrow: t('request.eyebrow'), title: t('request.title'), intro: t('request.intro'),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('requestedDate', date), labels('requestedTime', time), labels('duration', duration), labels('price', price)],
        callout: options.salonPhone ? { title: t('request.calloutTitle'), body: t('request.calloutBody', { phone: options.salonPhone }) } : undefined,
        cta: { label: t('request.cta'), href: url(locale, '/appointments') },
        footnotes: [t('request.footnote')],
        reference: t('common.referenceShort', { reference }),
      };
    case 'CANCELLATION':
      return {
        ...base,
        subject: t('cancellation.subject'),
        preview: t('cancellation.preview', { service, date }),
        eyebrow: t('cancellation.eyebrow'), title: t('cancellation.title'), intro: t('cancellation.intro'),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date), labels('time', time)],
        cta: { label: t('cancellation.cta'), href: url(locale, '/book') },
        footnotes: [t('cancellation.footnote')],
      };
    case 'RESCHEDULE': {
      if (!options.oldDate) throw new Error('Reschedule notification requires the original date');
      const previous = `${formatSalonLongDate(locale, options.oldDate)} ${formatSalonClock(locale, options.oldDate)}`;
      return {
        ...base,
        subject: t('reschedule.subject'),
        preview: t('reschedule.preview', { date }),
        eyebrow: t('reschedule.eyebrow'), title: t('reschedule.title'), intro: t('reschedule.intro', { previous }),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date), labels('time', time), labels('previousDate', previous)],
        cta: { label: t('reschedule.cta'), href: url(locale, '/appointments') },
        footnotes: [t('reschedule.footnote')],
      };
    }
    case 'REMINDER': {
      const when = salonRelativeDay(appointment.date, options.now);
      return {
        ...base,
        subject: when === 'today' ? t('reminder.subjectToday') : when === 'tomorrow' ? t('reminder.subjectTomorrow') : t('reminder.subjectSoon'),
        preview: t('reminder.preview', { service, time }),
        eyebrow: t('reminder.eyebrow'),
        title: when === 'today' ? t('reminder.titleToday') : when === 'tomorrow' ? t('reminder.titleTomorrow') : t('reminder.titleSoon'),
        intro: t('reminder.intro'),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date), labels('time', time), labels('duration', duration)],
        callout: { title: t('labels.whereToFind'), body: t('common.address') },
        cta: { label: t('reminder.cta'), href: url(locale, '/appointments') },
        footnotes: [t('reminder.footnote')],
      };
    }
    case 'REVIEW_REQUEST':
      return {
        ...base,
        subject: t('review.subject'),
        preview: t('review.preview'),
        eyebrow: t('review.eyebrow'), title: t('review.title'), intro: t('review.intro'),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date)],
        cta: { label: t('review.cta'), href: `${url(locale, '/reviews/new')}?appointmentId=${encodeURIComponent(appointment.id)}` },
        footnotes: [t('review.footnote')],
      };
    case 'SALON_ALERT': {
      // Staff mail: customer name, email, phone and notes are shown exactly as entered.
      const customer = name || t('values.nameNotGiven');
      return {
        ...base,
        greeting: null,
        subject: t('salonAlert.subject'),
        preview: t('salonAlert.preview', { customer, service, date, time }),
        eyebrow: t('salonAlert.eyebrow'), title: t('salonAlert.title'), intro: t('salonAlert.intro'),
        details: [
          labels('service', service), labels('date', date), labels('time', time), labels('stylist', appointment.stylist.name),
          labels('duration', duration), labels('price', price),
          { label: t('labels.customer'), value: customer },
          { label: t('labels.email'), value: appointment.user.email },
          { label: t('labels.phone'), value: appointment.user.phone || t('values.notProvided') },
          ...(appointment.notes ? [{ label: t('labels.notes'), value: appointment.notes }] : []),
        ],
        cta: { label: t('salonAlert.cta'), href: url(locale, '/admin') },
        footnotes: [t('salonAlert.footnote')],
        reference: t('common.referenceShort', { reference }),
      };
    }
    case 'RESCHEDULE_REQUEST_RECEIVED':
    case 'SALON_RESCHEDULE_ALERT':
    case 'RESCHEDULE_DECLINED':
    case 'RESCHEDULE_LAPSED': {
      if (!options.requestedDate) throw new Error('Reschedule-request notification requires the requested date');
      const requested = `${formatSalonLongDate(locale, options.requestedDate)} ${formatSalonClock(locale, options.requestedDate)}`;
      const current = `${date} ${time}`;
      if (kind === 'SALON_RESCHEDULE_ALERT') {
        const customer = name || t('values.nameNotGiven');
        return {
          ...base,
          greeting: null,
          subject: t('salonRescheduleAlert.subject'),
          preview: t('salonRescheduleAlert.preview', { customer, service, requested }),
          eyebrow: t('salonRescheduleAlert.eyebrow'), title: t('salonRescheduleAlert.title'), intro: t('salonRescheduleAlert.intro'),
          details: [
            labels('service', service), labels('stylist', appointment.stylist.name),
            labels('currentTime', current), labels('requestedDate', formatSalonLongDate(locale, options.requestedDate)),
            labels('requestedTime', formatSalonClock(locale, options.requestedDate)),
            { label: t('labels.customer'), value: customer },
            { label: t('labels.email'), value: appointment.user.email },
            { label: t('labels.phone'), value: appointment.user.phone || t('values.notProvided') },
          ],
          cta: { label: t('salonRescheduleAlert.cta'), href: url(locale, '/admin') },
          footnotes: [t('salonRescheduleAlert.footnote')],
          reference: t('common.referenceShort', { reference }),
        };
      }
      const section = kind === 'RESCHEDULE_REQUEST_RECEIVED' ? 'rescheduleRequest' : kind === 'RESCHEDULE_DECLINED' ? 'rescheduleDeclined' : 'rescheduleLapsed';
      return {
        ...base,
        subject: t(`${section}.subject`),
        preview: t(`${section}.preview`, { requested }),
        eyebrow: t(`${section}.eyebrow`), title: t(`${section}.title`), intro: t(`${section}.intro`, { requested }),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('currentTime', current), labels('requestedDate', formatSalonLongDate(locale, options.requestedDate)), labels('requestedTime', formatSalonClock(locale, options.requestedDate))],
        cta: { label: t(`${section}.cta`), href: url(locale, '/appointments') },
        footnotes: [t(`${section}.footnote`)],
      };
    }
  }
}

/**
 * The link that proves an account receives mail at its address. It opens an
 * API route, not a page: the route records the proof, then sends the visitor
 * on in the language carried inside the signed token.
 */
export function emailVerificationContent(user: { name: string | null }, token: string, expiresInHours: number, locale: Locale): EmailContent {
  const t = translator(locale, 'emails');
  const name = user.name?.trim();
  return {
    locale,
    palette: 'ink',
    subject: t('emailVerification.subject'),
    preview: t('emailVerification.preview'),
    eyebrow: t('emailVerification.eyebrow'),
    title: t('emailVerification.title'),
    greeting: name ? t('common.greeting', { name }) : t('common.greetingNoName'),
    intro: t('emailVerification.intro'),
    details: [],
    cta: { label: t('emailVerification.cta'), href: `${SITE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}` },
    footnotes: [t('emailVerification.expiry', { hours: expiresInHours }), t('emailVerification.ignore')],
    address: t('common.address'),
  };
}

export function passwordResetContent(user: { name: string | null }, token: string, expiresInMinutes: number, locale: Locale): EmailContent {
  const t = translator(locale, 'emails');
  const name = user.name?.trim();
  return {
    locale,
    palette: 'ink',
    subject: t('passwordReset.subject'),
    preview: t('passwordReset.preview'),
    eyebrow: t('passwordReset.eyebrow'),
    title: t('passwordReset.title'),
    greeting: name ? t('common.greeting', { name }) : t('common.greetingNoName'),
    intro: t('passwordReset.intro'),
    details: [],
    // The token stays a query parameter on the reset page, in the language
    // the reset was requested from.
    cta: { label: t('passwordReset.cta'), href: `${url(locale, '/auth/reset-password')}?token=${encodeURIComponent(token)}` },
    footnotes: [t('passwordReset.expiry', { minutes: expiresInMinutes }), t('passwordReset.ignore')],
    address: t('common.address'),
  };
}

/**
 * Sent when someone asks to stop marketing mail for this address. Nothing
 * changes until the link is used, so a stranger who types the address in
 * achieves nothing but this one email.
 */
export function marketingUnsubscribeContent(confirmUrl: string, expiresInDays: number, locale: Locale): EmailContent {
  const t = translator(locale, 'emails');
  return {
    locale,
    palette: 'ink',
    subject: t('marketingUnsubscribe.subject'),
    preview: t('marketingUnsubscribe.preview'),
    eyebrow: t('marketingUnsubscribe.eyebrow'),
    title: t('marketingUnsubscribe.title'),
    greeting: t('common.greetingNoName'),
    intro: t('marketingUnsubscribe.intro'),
    details: [],
    cta: { label: t('marketingUnsubscribe.cta'), href: confirmUrl },
    footnotes: [t('marketingUnsubscribe.expiry', { days: expiresInDays }), t('marketingUnsubscribe.ignore')],
    address: t('common.address'),
  };
}

/** The plain-text part: same words as the HTML, one fact per line. */
export function renderPlainText(content: EmailContent): string {
  const t = translator(content.locale, 'emails');
  const lines = [
    `${t('common.brand')} — ${content.eyebrow.toUpperCase()}`,
    '',
    ...(content.greeting ? [content.greeting, ''] : []),
    content.title,
    content.intro,
    '',
    ...content.details.map((row) => `${row.label}: ${row.value}`),
    ...(content.reference ? [content.reference] : []),
    '',
    ...(content.callout ? [`${content.callout.title}: ${content.callout.body}`, ''] : []),
    ...(content.cta ? [`${content.cta.label}: ${content.cta.href}`, ''] : []),
    ...content.footnotes,
    '',
    `${t('labels.location')}: ${content.address}`,
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
