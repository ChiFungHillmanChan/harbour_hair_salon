import { reportCardCheckFailure } from '@/app/actions/card-check';
import type { CardCheckFailure } from '@/app/lib/card-check-report';
import type { SquarePublicConfig } from './square-web-payments';

/**
 * Tell the server why the booking page's card step failed
 * (actions/card-check.ts). Fire and forget: the customer already sees the
 * failure, and a report that cannot be sent must never add a second one.
 */
export function sendCardCheckFailure(failure: CardCheckFailure, environment: SquarePublicConfig['environment']) {
  try {
    void reportCardCheckFailure({ ...failure, environment }).catch(() => undefined);
  } catch {
    // Not even sent.
  }
}
