/**
 * Sentinel stylist id for the "Anyone / first available" booking option.
 * Lives in a client-safe module so both the wizard and the server actions can
 * import it without pulling in Prisma.
 */
export const ANY_STYLIST_ID = 'any';
