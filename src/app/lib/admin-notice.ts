/**
 * A failure whose message is already translated and written for the admin
 * (e.g. "this service has 3 bookings, retire it instead"). Row actions show
 * ONLY these messages; any other error — a Prisma or driver error whose text
 * can name tables, constraints or hosts — becomes the generic "couldn't
 * delete" line instead, and is logged server-side.
 */
export class AdminNoticeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminNoticeError';
  }
}

/** The message to put in front of the admin: ours verbatim, anything else generic. */
export function adminFacingMessage(error: unknown, fallback: string): string {
  return error instanceof AdminNoticeError ? error.message : fallback;
}
