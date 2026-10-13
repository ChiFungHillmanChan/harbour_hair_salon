import { parseSquareConfig, type SquareConfig } from './square-config';
import type { SquarePublicConfig } from '@/components/booking/square-web-payments';

/**
 * ONLINE BOOKING OPENS IN PRODUCTION ONLY WITH SQUARE PRODUCTION CREDENTIALS.
 *
 * Self-service booking requests take a card deposit through Square
 * (docs/superpowers/specs/2026-10-13-square-deposits-design.md), so a
 * production build refuses to open online booking, whatever Admin → Settings
 * or the database says, unless this deployment's Square configuration parses
 * (lib/square-config.ts) and is for Square's PRODUCTION environment:
 *
 *   - Square not configured, or SQUARE_PAYMENTS_ENABLED not "true": locked;
 *   - sandbox credentials: locked (test cards can never open the live site);
 *   - a configuration that does not parse (missing, placeholder or malformed
 *     values): locked, never an error page.
 *
 * The gate in lib/booking-maintenance.ts answers "closed" before it reads
 * anything, and the settings screen will not switch booking on. Customers keep
 * booking by phone and on the marketplaces.
 *
 * SQUARE_DEPOSITS_WIRED records that the deposit code path exists. Setting it
 * back to false closes production online booking whatever the configuration
 * (the lock as it was before deposits).
 */
export const SQUARE_DEPOSITS_WIRED = true;

let reportedInvalidConfiguration = false;
let reportedRefusedEnvironment = false;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Fails closed: EVERY production build is a candidate (Next.js always runs
 * with NODE_ENV=production there), whether or not Vercel exposes VERCEL_ENV at
 * runtime — a lock that depended on that project setting would open silently
 * if it were ever switched off. Only an explicit Vercel preview is exempt.
 * Development, unit tests and the CI integration scripts are not production
 * builds, so the booking flow itself stays testable.
 */
function isProductionBuild(env: Env): boolean {
  return env.NODE_ENV === 'production' && env.VERCEL_ENV !== 'preview';
}

/** The configuration, or null; a configuration that does not parse is reported once and counts as none. */
function readSquareConfig(env: Env, context: string): SquareConfig | null {
  try {
    return parseSquareConfig(env);
  } catch (error) {
    // Name the field once per instance so a typo is findable in the logs; the
    // message never carries a value (lib/square-config.ts).
    if (!reportedInvalidConfiguration) {
      reportedInvalidConfiguration = true;
      console.error(`${context}:`, error instanceof Error ? error.message : 'invalid Square configuration');
    }
    return null;
  }
}

/** Read at call time, never at module load (project convention). */
export function isOnlineBookingLockedForPayments(env: Env = process.env): boolean {
  if (!isProductionBuild(env)) return false;
  if (!SQUARE_DEPOSITS_WIRED) return true;
  return readSquareConfig(env, 'Online booking stays locked')?.environment !== 'production';
}

/**
 * The Square configuration a customer's deposit may be taken with in this
 * deployment, or null — the same rule as the lock above, so a booking can
 * never take money the lock would not open for: in a production build only
 * PRODUCTION credentials count (sandbox test cards never take a live booking);
 * everywhere else (a Vercel preview, development, tests) only SANDBOX
 * credentials count — a preview runs any branch's code against a copy of the
 * production database, so real cards and real money only ever move from a
 * production build. Every Square call goes through this (the card form, the
 * submission, captures, releases, refunds, the webhook, reconciliation).
 * Never throws: switched off, incomplete, malformed or the wrong environment
 * counts as none, and a booking that owes a deposit is then refused
 * (PAYMENT_UNAVAILABLE). Contains the access token: server code only, never a
 * client prop.
 */
export function usableSquareConfig(env: Env = process.env): SquareConfig | null {
  if (!SQUARE_DEPOSITS_WIRED) return null;
  const config = readSquareConfig(env, 'Card deposits are unavailable');
  if (!config) return null;
  if ((config.environment === 'production') === isProductionBuild(env)) return config;
  // Reported once per instance so a misplaced variable is findable; the rule only, never a value.
  if (!reportedRefusedEnvironment) {
    reportedRefusedEnvironment = true;
    console.error(isProductionBuild(env)
      ? 'Card deposits are unavailable: a production build only uses Square production credentials'
      : 'Card deposits are unavailable: Square production credentials are only used by a production build (previews, development and tests use the sandbox)');
  }
  return null;
}

/**
 * What the booking page's card form may know about that configuration — the
 * application and location ids and the environment, all public by Square's
 * design — or null when no deposit can be taken. Never the access token or
 * the webhook key: this is the only Square value passed to the browser.
 */
export function publicSquareConfig(env: Env = process.env): SquarePublicConfig | null {
  const config = usableSquareConfig(env);
  return config ? { applicationId: config.applicationId, locationId: config.locationId, environment: config.environment } : null;
}
