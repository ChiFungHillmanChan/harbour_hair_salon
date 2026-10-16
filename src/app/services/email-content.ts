import type { Locale } from '@/i18n/config';
import { HTML_LANG } from '@/i18n/config';
import { translator } from '@/i18n/messages';
import { localizeHref } from '@/i18n/paths';
import { formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
import { SITE_URL } from '@/app/lib/site-url';
import { formatGBP, toPence } from './pricing/money';
import type { PriceNature, PriceType, VatDisplay } from './pricing/policy';
import { salonRelativeDay } from './salon-time';
import { LATE_ARRIVAL_CANCEL_MINUTES } from '@/app/lib/booking-constants';
import { appointmentCalendarEvent } from './appointment-calendar';
import { appointmentGoogleCalendarUrl, appointmentIcsFile, type IcsMethod, type IcsOrganizer } from '@/app/lib/calendar-links';

/**
 * What an email may say about a booking's price. Built from the booking's own
 * frozen amount and quote (never today's price list). `known: false` is a
 * booking made before prices were recorded — the email says so instead of
 * inventing an amount.
 */
export type EmailPrice =
  | { known: true; amountPence: number; priceType: PriceType | null; vatDisplay: VatDisplay | null; priceNature: PriceNature | null }
  | { known: false };

/**
 * The booking's card deposit as it stood when the email was queued: an amount
 * and its PaymentAttempt status (AUTHORIZED = held on the card, not taken;
 * CAPTURED = taken). Absent or null: no deposit (or an event queued before
 * deposits existed).
 */
export type EmailDeposit = { amountPence: number; status: string };

/**
 * What became of a booking's deposit when the booking closed
 * (services/deposit-lifecycle.ts): refunded, its hold released, or kept by
 * the salon. Carried in the queued options, so no database read at send time.
 */
export type DepositOutcome = 'REFUNDING' | 'RELEASED' | 'KEPT';

export type EmailAppointment = {
  id: string;
  date: Date;
  user: { email: string; name: string | null; phone?: string | null };
  stylist: { name: string };
  service: { name: string; duration: number };
  price: EmailPrice;
  notes?: string | null;
  deposit?: EmailDeposit | null;
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
  | 'RESCHEDULE_REQUEST_RECEIVED' | 'SALON_RESCHEDULE_ALERT' | 'RESCHEDULE_DECLINED' | 'RESCHEDULE_LAPSED' | 'REQUEST_LAPSED'
  | 'LATE_CANCELLED';

/** Kinds addressed to the salon (its address and language), never the customer. */
export function isSalonEmailKind(kind: AppointmentEmailKind): boolean {
  return kind === 'SALON_ALERT' || kind === 'SALON_RESCHEDULE_ALERT';
}

/** Kinds that belong to one reschedule request (keyed by its `requestedAt`). */
export const RESCHEDULE_REQUEST_EMAIL_KINDS: readonly AppointmentEmailKind[] = ['RESCHEDULE_REQUEST_RECEIVED', 'SALON_RESCHEDULE_ALERT', 'RESCHEDULE_DECLINED', 'RESCHEDULE_LAPSED'];

export type EmailContent = {
  locale: Locale;
  /** Every mail uses the monochrome salon look (client requirement: no blue or gold). */
  palette: 'ink';
  subject: string;
  preview: string;
  eyebrow: string;
  title: string;
  greeting: string | null;
  intro: string;
  details: { label: string; value: string }[];
  callout?: { title: string; body: string };
  cta?: { label: string; href: string };
  /** Smaller text links under the button (e.g. "Add to Google Calendar"). */
  links?: { label: string; href: string }[];
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

export type AppointmentEmailOptions = {
  salonPhone?: string; oldDate?: Date; requestedDate?: Date; now?: Date;
  /** The appointment's notificationVersion when the event was queued: the calendar entry's SEQUENCE. */
  sequence?: number;
  /**
   * CANCELLATION only: whether the booking had been confirmed when it was
   * cancelled. A request nobody confirmed was never offered to the customer's
   * calendar, so its cancellation carries no calendar file and no "remove it"
   * note. Undefined — mail queued before this was recorded — counts as confirmed.
   */
  wasConfirmed?: boolean;
  /**
   * CANCELLATION, LATE_CANCELLED and REQUEST_LAPSED: what became of the booking's card deposit
   * (the amount is the queued snapshot's `deposit`). Undefined — no deposit,
   * or mail queued before deposits — adds no deposit wording.
   */
  depositOutcome?: DepositOutcome;
  /**
   * REQUEST_LAPSED only: closed because the hold on the customer's card ran
   * out before anyone confirmed it, while the requested time is still ahead.
   */
  holdExpired?: boolean;
};

/** "£20.00" in the email's language. */
function money(pence: number, locale: Locale): string {
  return formatGBP(pence, HTML_LANG[locale]);
}

/** A deposit amount the snapshot can vouch for, or null (none, or an unusable value). */
function depositAmount(deposit: EmailDeposit | null | undefined): number | null {
  return deposit && Number.isSafeInteger(deposit.amountPence) && deposit.amountPence > 0 ? deposit.amountPence : null;
}

/**
 * What a closing email says about the deposit: a Deposit row and one
 * sentence (refunded, released or kept), or nothing without an outcome.
 */
function depositClosingNote(appointment: EmailAppointment, locale: Locale, outcome: DepositOutcome | undefined) {
  const pence = depositAmount(appointment.deposit);
  if (!outcome || pence === null) return null;
  const t = translator(locale, 'emails');
  const amount = money(pence, locale);
  const [value, sentence] = outcome === 'REFUNDING'
    ? [t('values.depositRefunding', { amount }), t('deposit.refunding', { amount })]
    : outcome === 'KEPT'
      ? [t('values.depositKept', { amount }), t('deposit.kept', { amount })]
      : [t('values.depositReleased', { amount }), t('deposit.released', { amount })];
  return { row: { label: t('labels.deposit'), value }, sentence };
}

/**
 * What is left to pay in the salon, with the fine print the price itself
 * carries when that amount is not exact: "£80.00 (VAT excluded · may be
 * adjusted after consultation)" (see describeEmailPrice).
 */
function remainderText(price: Extract<EmailPrice, { known: true }>, depositPence: number, locale: Locale): string {
  const t = translator(locale, 'emails');
  const amount = money(price.amountPence - depositPence, locale);
  const notes = [
    ...(price.vatDisplay === 'EXCLUDED' ? [t('values.vatExcluded')] : []),
    ...(price.priceNature === 'SUBJECT_TO_CONSULTATION' ? [t('values.subjectToConsultation')] : []),
  ];
  return notes.length ? t('values.withNotes', { amount, notes: notes.join(' · ') }) : amount;
}

/**
 * The confirmation's deposit wording: what was paid and what is left to pay
 * in the salon — from the booking's own recorded price, never today's.
 */
function depositPaidNote(appointment: EmailAppointment, locale: Locale) {
  const pence = appointment.deposit?.status === 'CAPTURED' ? depositAmount(appointment.deposit) : null;
  if (pence === null) return null;
  const t = translator(locale, 'emails');
  const deposit = money(pence, locale);
  const sentence = !appointment.price.known
    ? t('confirmation.depositPaidNoTotal', { deposit })
    : appointment.price.amountPence > pence
      ? t('confirmation.depositPaid', { deposit, remainder: remainderText(appointment.price, pence, locale) })
      : t('confirmation.depositPaidInFull', { deposit });
  return { row: { label: t('labels.deposit'), value: t('values.depositPaid', { amount: deposit }) }, sentence };
}

/**
 * The calendar file a customer email carries. A confirmed time (confirmation,
 * approved move, reminder) adds or updates the customer's own calendar entry;
 * a confirmed booking's cancellation removes it. Never for a request that is
 * not confirmed yet — nor for its cancellation (`wasConfirmed: false`) — nor
 * for staff mail.
 */
export function calendarMethodFor(kind: AppointmentEmailKind, options: Pick<AppointmentEmailOptions, 'wasConfirmed'> = {}): IcsMethod | null {
  switch (kind) {
    case 'CONFIRMATION':
    case 'RESCHEDULE':
    case 'REMINDER':
      return 'PUBLISH';
    case 'CANCELLATION':
      return options.wasConfirmed === false ? null : 'CANCEL';
    // Only a confirmed booking is ever cancelled by the late-arrival rule.
    case 'LATE_CANCELLED':
      return 'CANCEL';
    default:
      return null;
  }
}

/** Built at dispatch from the queued snapshot alone: no database read. */
function calendarEventFor(appointment: EmailAppointment, locale: Locale, options: AppointmentEmailOptions) {
  return appointmentCalendarEvent({
    id: appointment.id, date: appointment.date, durationMinutes: appointment.service.duration,
    serviceName: appointment.service.name, stylistName: appointment.stylist.name, sequence: options.sequence ?? 0,
  }, locale);
}

/**
 * The .ics attachment for an appointment email, or null when the kind carries
 * none (see calendarMethodFor). `organizer`: the sender (email-service.ts).
 */
export function appointmentCalendarFile(
  kind: AppointmentEmailKind,
  appointment: EmailAppointment,
  locale: Locale,
  options: AppointmentEmailOptions = {},
  organizer?: IcsOrganizer,
): { filename: string; method: IcsMethod; ics: string } | null {
  const method = calendarMethodFor(kind, options);
  if (!method) return null;
  const event = calendarEventFor(appointment, locale, options);
  return { filename: event.filename, method, ics: appointmentIcsFile(event, method, options.now, organizer) };
}

/** The words of every appointment email, in one language, from one place (HTML and plain text share them). */
export function appointmentEmailContent(
  kind: AppointmentEmailKind,
  appointment: EmailAppointment,
  locale: Locale,
  options: AppointmentEmailOptions = {},
): EmailContent {
  const t = translator(locale, 'emails');
  // A confirmed time can go straight into the customer's Google Calendar; the
  // attached file (email-service) covers every other calendar app.
  const calendarLinks = () => [{ label: t('calendar.addToGoogle'), href: appointmentGoogleCalendarUrl(calendarEventFor(appointment, locale, options)) }];
  const date = formatSalonLongDate(locale, appointment.date);
  const time = formatSalonClock(locale, appointment.date);
  const reference = appointment.id.slice(-8).toUpperCase();
  const name = appointment.user.name?.trim();
  const greeting = name ? t('common.greeting', { name }) : t('common.greetingNoName');
  const service = appointment.service.name;
  const duration = t('values.minutes', { count: appointment.service.duration });
  const price = describeEmailPrice(appointment.price, locale);
  const lateArrival = t('common.lateArrival', { minutes: LATE_ARRIVAL_CANCEL_MINUTES });
  const base = { locale, palette: 'ink' as const, greeting, footnotes: [] as string[], reference: t('common.reference', { reference }), address: t('common.address') };
  const labels = (key: 'service' | 'stylist' | 'date' | 'time' | 'requestedDate' | 'requestedTime' | 'duration' | 'price' | 'deposit' | 'previousDate' | 'currentTime', value: string) => ({ label: t(`labels.${key}`), value });

  switch (kind) {
    case 'CONFIRMATION': {
      // A deposit taken when the salon confirmed (services/deposit-lifecycle.ts):
      // what was paid and what is left to pay in the salon.
      const paid = depositPaidNote(appointment, locale);
      return {
        ...base,
        subject: t('confirmation.subject'),
        preview: t('confirmation.preview', { service, date }),
        eyebrow: t('confirmation.eyebrow'), title: t('confirmation.title'), intro: t('confirmation.intro'),
        details: [
          labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date), labels('time', time), labels('duration', duration), labels('price', price),
          ...(paid ? [paid.row] : []),
        ],
        callout: { title: t('labels.whereToFind'), body: t('common.address') },
        cta: { label: t('confirmation.cta'), href: url(locale, '/appointments') },
        links: calendarLinks(),
        footnotes: paid ? [lateArrival, t('confirmation.footnoteWithDeposit'), paid.sentence, t('calendar.attached')] : [lateArrival, t('confirmation.footnote'), t('calendar.attached')],
      };
    }
    case 'REQUEST_RECEIVED': {
      // A deposit Square holds for this request: taken only if the salon
      // confirms it, released otherwise (services/payment-attempts.ts).
      const hold = appointment.deposit?.status === 'AUTHORIZED' && appointment.deposit.amountPence > 0
        ? formatGBP(appointment.deposit.amountPence, HTML_LANG[locale])
        : null;
      return {
        ...base,
        subject: t('request.subject'),
        preview: t('request.preview', { service, date }),
        eyebrow: t('request.eyebrow'), title: t('request.title'), intro: t('request.intro'),
        details: [
          labels('service', service), labels('stylist', appointment.stylist.name), labels('requestedDate', date), labels('requestedTime', time), labels('duration', duration), labels('price', price),
          ...(hold ? [labels('deposit', t('values.depositHeld', { amount: hold }))] : []),
        ],
        callout: options.salonPhone ? { title: t('request.calloutTitle'), body: t('request.calloutBody', { phone: options.salonPhone }) } : undefined,
        cta: { label: t('request.cta'), href: url(locale, '/appointments') },
        // "Payment is due at the salon" is only true in full without a deposit.
        footnotes: hold ? [t('request.depositHold', { amount: hold }), t('request.footnoteWithDeposit')] : [t('request.footnote')],
        reference: t('common.referenceShort', { reference }),
      };
    }
    case 'REQUEST_LAPSED': {
      // A booking request nobody confirmed before its time came — or before
      // the hold on the customer's card ran out (pending-request-lapse.ts).
      const deposit = depositClosingNote(appointment, locale, options.depositOutcome);
      return {
        ...base,
        subject: t('requestLapsed.subject'),
        preview: t('requestLapsed.preview', { service, date }),
        eyebrow: t('requestLapsed.eyebrow'), title: t('requestLapsed.title'),
        intro: options.holdExpired ? t('requestLapsed.introHoldExpired', { date, time }) : t('requestLapsed.intro', { date, time }),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('requestedDate', date), labels('requestedTime', time), ...(deposit ? [deposit.row] : [])],
        callout: options.salonPhone ? { title: t('rescheduleAnotherTime.calloutTitle'), body: t('rescheduleAnotherTime.calloutBody', { phone: options.salonPhone }) } : undefined,
        cta: { label: t('requestLapsed.cta'), href: url(locale, '/book') },
        footnotes: [...(deposit ? [deposit.sentence] : []), t('requestLapsed.footnote')],
        reference: t('common.referenceShort', { reference }),
      };
    }
    case 'CANCELLATION': {
      // Refunded, hold released, or kept (services/deposit-lifecycle.ts).
      const deposit = depositClosingNote(appointment, locale, options.depositOutcome);
      return {
        ...base,
        subject: t('cancellation.subject'),
        preview: t('cancellation.preview', { service, date }),
        eyebrow: t('cancellation.eyebrow'), title: t('cancellation.title'), intro: t('cancellation.intro'),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date), labels('time', time), ...(deposit ? [deposit.row] : [])],
        cta: { label: t('cancellation.cta'), href: url(locale, '/book') },
        // A Google link can only add; the attached CANCEL file removes the entry
        // elsewhere. A request never confirmed is in no calendar: nothing to remove.
        footnotes: [...(deposit ? [deposit.sentence] : []), ...(calendarMethodFor(kind, options) ? [t('calendar.cancelled')] : []), t('cancellation.footnote')],
      };
    }
    case 'LATE_CANCELLED': {
      // The late-arrival rule cancelled a confirmed booking whose customer had
      // not arrived 15 minutes after the start (services/late-arrival-cancel.ts).
      const deposit = depositClosingNote(appointment, locale, options.depositOutcome);
      return {
        ...base,
        subject: t('lateCancelled.subject'),
        preview: t('lateCancelled.preview', { service, date }),
        eyebrow: t('lateCancelled.eyebrow'), title: t('lateCancelled.title'),
        intro: t('lateCancelled.intro', { date, time, minutes: LATE_ARRIVAL_CANCEL_MINUTES }),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date), labels('time', time), ...(deposit ? [deposit.row] : [])],
        callout: options.salonPhone ? { title: t('lateCancelled.calloutTitle'), body: t('lateCancelled.calloutBody', { phone: options.salonPhone }) } : undefined,
        cta: { label: t('lateCancelled.cta'), href: url(locale, '/book') },
        footnotes: [...(deposit ? [deposit.sentence] : []), t('calendar.cancelled'), t('lateCancelled.footnote')],
      };
    }
    case 'RESCHEDULE': {
      if (!options.oldDate) throw new Error('Reschedule notification requires the original date');
      const previous = `${formatSalonLongDate(locale, options.oldDate)} ${formatSalonClock(locale, options.oldDate)}`;
      // A staff move that closed the customer's open request says what became of it.
      const closedRequest = options.requestedDate;
      const requestNote = !closedRequest ? []
        : closedRequest.getTime() === appointment.date.getTime() ? [t('reschedule.requestMatched')]
          : [t('reschedule.requestReplaced', { requested: `${formatSalonLongDate(locale, closedRequest)} ${formatSalonClock(locale, closedRequest)}` })];
      return {
        ...base,
        subject: t('reschedule.subject'),
        preview: t('reschedule.preview', { date }),
        eyebrow: t('reschedule.eyebrow'), title: t('reschedule.title'), intro: t('reschedule.intro', { previous }),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date), labels('time', time), labels('previousDate', previous)],
        cta: { label: t('reschedule.cta'), href: url(locale, '/appointments') },
        links: calendarLinks(),
        footnotes: [...requestNote, t('reschedule.footnote'), t('calendar.moved'), t('calendar.attached')],
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
        links: calendarLinks(),
        footnotes: [lateArrival, t('reminder.footnote'), t('calendar.attached')],
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
      // A closed request tells the customer how to reach the salon for another time.
      const closed = kind === 'RESCHEDULE_DECLINED' || kind === 'RESCHEDULE_LAPSED';
      return {
        ...base,
        subject: t(`${section}.subject`),
        preview: t(`${section}.preview`, { requested }),
        eyebrow: t(`${section}.eyebrow`), title: t(`${section}.title`), intro: t(`${section}.intro`, { requested }),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('currentTime', current), labels('requestedDate', formatSalonLongDate(locale, options.requestedDate)), labels('requestedTime', formatSalonClock(locale, options.requestedDate))],
        callout: closed && options.salonPhone ? { title: t('rescheduleAnotherTime.calloutTitle'), body: t('rescheduleAnotherTime.calloutBody', { phone: options.salonPhone }) } : undefined,
        cta: { label: t(`${section}.cta`), href: url(locale, '/appointments') },
        footnotes: [t(`${section}.footnote`)],
      };
    }
  }
}

/**
 * The link that proves an account receives mail at its address. It opens the
 * confirm page in the mail's language, where a button records the proof:
 * opening the link alone changes nothing, so mail scanners cannot confirm it.
 */
export function emailVerificationContent(token: string, expiresInHours: number, locale: Locale): EmailContent {
  const t = translator(locale, 'emails');
  return {
    locale,
    palette: 'ink',
    subject: t('emailVerification.subject'),
    preview: t('emailVerification.preview'),
    eyebrow: t('emailVerification.eyebrow'),
    title: t('emailVerification.title'),
    // Never the account name: whoever registered the address typed it, and this mail goes to that address.
    greeting: t('common.greetingNoName'),
    intro: t('emailVerification.intro'),
    details: [],
    cta: { label: t('emailVerification.cta'), href: `${url(locale, '/auth/verify-email/confirm')}?token=${encodeURIComponent(token)}` },
    footnotes: [t('emailVerification.expiry', { hours: expiresInHours }), t('emailVerification.ignore')],
    address: t('common.address'),
  };
}

export function passwordResetContent(token: string, expiresInMinutes: number, locale: Locale): EmailContent {
  const t = translator(locale, 'emails');
  return {
    locale,
    palette: 'ink',
    subject: t('passwordReset.subject'),
    preview: t('passwordReset.preview'),
    eyebrow: t('passwordReset.eyebrow'),
    title: t('passwordReset.title'),
    // Never the account name: an unverified account's name was typed by whoever registered the address.
    greeting: t('common.greetingNoName'),
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
    ...(content.links?.length ? [...content.links.map((link) => `${link.label}: ${link.href}`), ''] : []),
    ...content.footnotes,
    '',
    `${t('labels.location')}: ${content.address}`,
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
