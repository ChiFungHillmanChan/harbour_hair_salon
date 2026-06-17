/**
 * Errors whose message is SAFE to show the customer. The booking actions surface
 * `instanceof BookingError` messages verbatim and replace anything else with a
 * generic message, so internal/Prisma errors never leak to the client.
 */
export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingError';
  }
}

/** A slot/stylist that was free at fetch time is no longer bookable. */
export class SlotUnavailableError extends BookingError {
  constructor(message = 'This time slot is no longer available. Please choose another time.') {
    super(message);
    this.name = 'SlotUnavailableError';
  }
}

/** A discount code could not be claimed (invalid, expired, or fully used). */
export class DiscountUnavailableError extends BookingError {
  constructor(message = 'Discount code could not be applied. It may have been fully claimed.') {
    super(message);
    this.name = 'DiscountUnavailableError';
  }
}
