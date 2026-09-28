import type { Prisma } from '@prisma/client';

/**
 * The Service columns that are safe to send to a browser.
 *
 * Public pages render services through client components, so every selected
 * column ends up in the RSC payload — readable by anyone who views source. A
 * bare `prisma.service.findMany()` therefore published the whole row, including
 * `treatwellExternalId` (an internal integration id), `calendarColor` (an
 * admin-only display setting) and the bookkeeping timestamps. The price-list
 * provenance (`priceSource`, `priceVerifiedAt`) stays internal too.
 *
 * Mirrors `publicStylistSelect` in app/stylists/slug.ts, which exists for the
 * same reason — that one keeps the secret `treatwellIcalUrl` and `icalToken`
 * out of the payload.
 *
 * Add a column here only after deciding it is fine for the public to read.
 */
export const publicServiceSelect = {
  id: true,
  name: true,
  description: true,
  price: true,
  duration: true,
  category: true,
  imageUrl: true,
  // Booking-gate flags: the booking wizard and the services menu both need
  // these to explain why a colour service routes to a consultation first.
  requiresPatchTest: true,
  isPatchTest: true,
  requiresConsultation: true,
  isConsultation: true,
  // Price-option model (services/pricing): which menu item, which hair length,
  // standard or NHS, and how the price is labelled.
  offeringId: true,
  hairLength: true,
  priceType: true,
  isBookable: true,
  priceVersion: true,
  vatDisplay: true,
  priceNature: true,
  durationConfirmed: true,
  priceNote: true,
  surchargeBaseServiceId: true,
  surchargeAmount: true,
} as const;

/** A Service row as fetched for a public page. */
export type PublicService = Prisma.ServiceGetPayload<{ select: typeof publicServiceSelect }>;

/** The same row after money is converted for client components. */
export type ClientPublicService = Omit<PublicService, 'price' | 'surchargeAmount'> & {
  price: number;
  amountPence: number;
  surchargeAmountPence: number | null;
  /** Both languages' names, so search finds a service whichever you type. */
  searchText: string;
  /** False when the visitor's language had no published translation (English shown). */
  translated: boolean;
};
