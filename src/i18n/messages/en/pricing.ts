import type { MessageTree } from '../../format';

const pricing = {
  hairLength: {
    SHORT: 'Short hair',
    MEDIUM: 'Medium hair',
    LONG: 'Long hair',
    EXTRA_LONG: 'Extra long hair',
  },
  priceType: {
    STANDARD: 'Standard price',
    NHS: 'NHS price',
  },
  columns: {
    option: 'Option',
    standard: 'Standard',
    nhs: 'NHS',
  },
  nhsApplies: 'NHS discount applies',
  /** Shown wherever an NHS/student price is offered, in emails and on My Bookings for such a booking (pricing/eligibility.ts). */
  eligibilityProof: 'NHS and student prices: please bring a valid NHS staff ID or student card to your appointment. Without one, the standard price applies.',
  nhsApplied: 'NHS price applied',
  vatExcluded: 'VAT excluded',
  subjectToConsultation: 'Final price confirmed at your consultation',
  extraLongBreakdown: 'Long hair price {base} + extra long {surcharge}',
  minutes: { one: '{count} min', other: '{count} mins' },
  durationAtConsultation: 'Time confirmed at consultation',
  noNhsPrice: 'No NHS price',
  unknownPrice: 'Price not recorded',
  unknownPriceHelp: 'This booking was made before prices were saved with each appointment. Please ask the salon if you need the amount.',
  from: 'From',
  /** One price with its "from" prefix: a consultation-required service's listed price is a starting point. */
  fromPrice: 'From {price}',
  /** Under a consultation-required price. {fee}: the consultation's own price; {months}: CONSULTATION_CREDIT_MONTHS. */
  consultationCreditNote: 'Consultation {fee}, taken off your treatment if you go ahead within {months} months.',
  range: '{min} – {max}',
  notBookableOnline: 'Call the salon to book this option',
  discountsPaused: 'Offers and discount codes are paused at the moment. Prices shown are the listed prices.',
  categories: {
    Haircuts: 'Haircuts',
    Colouring: 'Colouring',
    Perms: 'Perms',
    Treatments: 'Treatments',
    Styling: 'Styling',
    Consultation: 'Consultation',
  },
  priceLabel: 'Price',
} satisfies MessageTree;

export default pricing;
