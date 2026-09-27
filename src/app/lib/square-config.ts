import 'server-only';

/** Contains credentials: never pass this object to a client component. */
export type SquareConfig = {
  environment: 'sandbox' | 'production';
  accessToken: string;
  applicationId: string;
  locationId: string;
  webhookSignatureKey: string;
  webhookNotificationUrl: string;
};

function invalidConfiguration(field: string): never {
  // Values can contain secrets, including credentials in malformed URLs.
  throw new Error(`Invalid Square configuration: ${field}`);
}

function requiredValue(env: Readonly<Record<string, string | undefined>>, field: string): string {
  const value = env[field]?.trim();
  if (!value || /\s/.test(value) || /^(?:\[SENSITIVE\]|<.*>|REPLACE_ME|CHANGE_ME)$/i.test(value)) {
    invalidConfiguration(field);
  }
  return value;
}

/** Disabled until explicitly requested. Enabling incomplete setup fails closed. */
export function parseSquareConfig(env: Readonly<Record<string, string | undefined>>): SquareConfig | null {
  if (env.SQUARE_PAYMENTS_ENABLED !== 'true') return null;

  const environment = env.SQUARE_ENVIRONMENT ?? 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') invalidConfiguration('SQUARE_ENVIRONMENT');

  const accessToken = requiredValue(env, 'SQUARE_ACCESS_TOKEN');
  const applicationId = requiredValue(env, 'SQUARE_APPLICATION_ID');
  const expectedPrefix = environment === 'sandbox' ? 'sandbox-sq0idb-' : 'sq0idp-';
  if (!applicationId.startsWith(expectedPrefix) || applicationId.length === expectedPrefix.length) {
    invalidConfiguration('SQUARE_APPLICATION_ID');
  }
  const locationId = requiredValue(env, 'SQUARE_LOCATION_ID');
  const webhookSignatureKey = requiredValue(env, 'SQUARE_WEBHOOK_SIGNATURE_KEY');
  const webhookNotificationUrl = requiredValue(env, 'SQUARE_WEBHOOK_NOTIFICATION_URL');

  // Square signs the configured URL verbatim. Validate it but return its exact
  // spelling, escaping, path and query instead of URL.toString() or a trimmed URL.
  if (webhookNotificationUrl !== env.SQUARE_WEBHOOK_NOTIFICATION_URL || !/^https:\/\//i.test(webhookNotificationUrl)) {
    invalidConfiguration('SQUARE_WEBHOOK_NOTIFICATION_URL');
  }
  try {
    const url = new URL(webhookNotificationUrl);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || webhookNotificationUrl.includes('#')) {
      invalidConfiguration('SQUARE_WEBHOOK_NOTIFICATION_URL');
    }
  } catch {
    invalidConfiguration('SQUARE_WEBHOOK_NOTIFICATION_URL');
  }

  return { environment, accessToken, applicationId, locationId, webhookSignatureKey, webhookNotificationUrl };
}

/** Read credentials only when needed at runtime, never during module import. */
export async function getSquareConfig(): Promise<SquareConfig | null> {
  return parseSquareConfig(process.env);
}
