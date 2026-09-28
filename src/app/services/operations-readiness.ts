import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { resolveRedisCredentials } from '@/app/lib/redis-credentials';

export const OPERATIONS_READINESS_JOB = 'operations-readiness';
const REQUIRED_CHECKS = ['configuration', 'database', 'email', 'resend', 'redis', 'notifications', 'cron'];
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
type Env = Partial<Record<string, string | undefined>>;
type ReadinessDb = Pick<Prisma.TransactionClient, 'backgroundJobState'>;
type DiagnosticDb = ReadinessDb & Pick<Prisma.TransactionClient, '$queryRaw'>;

// `label` and `message` stay English (logs, reports saved before codes
// existed). The admin page words each check from its `id` and `code` in the
// admin's language (adminOps.readiness); `params` carry only raw provider
// diagnostics such as an HTTP status.
const checkSchema = z.object({
  id: z.string(), status: z.enum(['pass', 'fail', 'unknown']),
  label: z.string().max(100), message: z.string().max(600),
  code: z.string().max(60).optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  fingerprint: z.string().optional(),
});
export type OperationCheck = z.infer<typeof checkSchema>;

/** A reason booking cannot open, as a code under adminOps.readiness.operations. */
export type ReadinessIssue = { code: string; params?: Record<string, string | number> };

export function parseOperationsChecks(json: string | null | undefined): OperationCheck[] {
  try {
    const parsed = z.array(checkSchema).safeParse(JSON.parse(json ?? 'null'));
    return parsed.success ? parsed.data : [];
  } catch { return []; }
}

function mailbox(value: string | undefined, allowName = false): string | null {
  const text = value?.trim() ?? '';
  const address = allowName && text.includes('<') ? text.match(/^[^<>\r\n]*<([^<>]+)>$/)?.[1] : text;
  return address && z.email().safeParse(address).success ? address.toLowerCase() : null;
}

// Every key here invalidates the stored diagnostics report, so each one must
// describe the CONFIGURATION being attested to — not which build is serving it.
// `VERCEL_DEPLOYMENT_ID` used to be in this list and is deliberately not: Vercel
// gives it a new value on every deployment and exposes it at runtime, so it made
// a passing report expire on every deploy. Because the comparison below runs on
// the live booking path, that silently closed online booking after each release
// — with no alert, no UI surfacing the blocker, and `SiteSettings.bookingEnabled`
// still reading `true` in the admin panel. It also contradicted the contract
// stated on `checkOperationsRuntimeReadiness` below: ongoing operation is not
// supposed to expire on a timer.
function configurationFingerprint(env: Env): string {
  const keys = ['EMAIL_FROM', 'EMAIL_REPLY_TO', 'SALON_NOTIFY_EMAIL', 'RESEND_API_KEY', 'CRON_SECRET',
    'NOTIFICATIONS_ENABLED', 'POSTGRES_URL', 'DATABASE_URL'];
  const redis = resolveRedisCredentials(env);
  return createHash('sha256').update(JSON.stringify([keys.map((key) => env[key]?.trim() ?? ''), redis])).digest('hex');
}

function runtimeChecks(env: Env): OperationCheck[] {
  const from = mailbox(env.EMAIL_FROM, true);
  const domain = from?.split('@')[1];
  const notify = mailbox(env.SALON_NOTIFY_EMAIL?.trim() || env.EMAIL_REPLY_TO);
  return [
    { id: 'configuration', label: 'Runtime configuration', status: 'pass', code: 'configuration.pass',
      message: 'These results apply to the settings checked in this environment.', fingerprint: configurationFingerprint(env) },
    { id: 'email', label: 'Booking email settings', status: from && domain !== 'resend.dev' && notify && env.RESEND_API_KEY?.trim() ? 'pass' : 'fail',
      ...(from && domain !== 'resend.dev' && notify && env.RESEND_API_KEY?.trim()
        ? { code: 'email.pass', message: 'A branded sender, salon notification mailbox and Resend key are configured.' }
        : { code: 'email.fail', message: 'Set EMAIL_FROM to a valid branded address, RESEND_API_KEY, and SALON_NOTIFY_EMAIL (or EMAIL_REPLY_TO).' }) },
    { id: 'notifications', label: 'Notification delivery', status: env.NOTIFICATIONS_ENABLED === 'true' ? 'pass' : 'fail',
      ...(env.NOTIFICATIONS_ENABLED === 'true'
        ? { code: 'notifications.pass', message: 'Notification delivery is enabled.' }
        : { code: 'notifications.fail', message: 'Enable NOTIFICATIONS_ENABLED after the salon authorises live notifications.' }) },
    { id: 'cron', label: 'Scheduled job authentication', status: env.CRON_SECRET?.trim() ? 'pass' : 'fail',
      ...(env.CRON_SECRET?.trim()
        ? { code: 'cron.pass', message: 'CRON_SECRET is configured. Check the job history below to confirm execution.' }
        : { code: 'cron.fail', message: 'Configure CRON_SECRET and deploy the scheduled jobs.' }) },
  ];
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Diagnostic timed out')), REQUEST_TIMEOUT_MS);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function resendCheck(env: Env, fetchImpl: typeof fetch): Promise<OperationCheck> {
  const base = { id: 'resend', label: 'Resend sender domain' };
  const domain = mailbox(env.EMAIL_FROM, true)?.split('@')[1];
  if (!domain || domain === 'resend.dev' || !env.RESEND_API_KEY?.trim()) {
    return { ...base, status: 'fail', code: 'resend.notConfigured', message: 'Configure a branded EMAIL_FROM and the matching Resend API key.' };
  }
  try {
    const response = await fetchImpl('https://api.resend.com/domains?limit=100', {
      method: 'GET', headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error', cache: 'no-store',
    });
    if (response.status === 403) return { ...base, status: 'unknown', code: 'resend.forbidden', message: 'This key cannot list domains (often a sending-only key). An authorised administrator must check the domain with a key that can read domains, then rerun diagnostics. No email was sent.' };
    if (!response.ok) return { ...base, status: 'fail', code: 'resend.httpError', params: { status: response.status }, message: `Resend domain lookup failed (HTTP ${response.status}). Check the account, key and service status.` };
    const body = await response.json();
    const domains = z.object({ data: z.array(z.object({ name: z.string(), status: z.string(),
      capabilities: z.object({ sending: z.string() }).optional() })), has_more: z.boolean().optional() }).safeParse(body);
    if (!domains.success) return { ...base, status: 'unknown', code: 'resend.unexpected', message: 'Resend returned an unexpected domain response. Review the provider settings and retry.' };
    const match = domains.data.data.find((entry) => entry.name.toLowerCase() === domain);
    if (!match && domains.data.has_more) return { ...base, status: 'unknown', code: 'resend.notOnFirstPage', message: 'The sender domain was not on the first domain page. Check the correct Resend team and review its domain list.' };
    if (match?.status === 'verified' && match.capabilities?.sending === 'enabled') {
      return { ...base, status: 'pass', code: 'resend.verified', message: 'Resend reports the configured sender domain as verified with sending enabled. Delivery to a real mailbox still needs acceptance testing.' };
    }
    return { ...base, status: 'fail', code: 'resend.unverified', message: 'The configured sender domain is absent, unverified or not enabled for sending in this Resend team. Verify its DNS and account ownership.' };
  } catch {
    return { ...base, status: 'fail', code: 'resend.unreachable', message: 'Resend could not be checked within the request limit. Check connectivity and provider availability, then retry.' };
  }
}

async function redisCheck(env: Env, fetchImpl: typeof fetch): Promise<OperationCheck> {
  const base = { id: 'redis', label: 'Shared Redis connection' };
  const credentials = resolveRedisCredentials(env);
  if (!credentials) return { ...base, status: 'fail', code: 'redis.notConfigured', message: 'Configure a matching Upstash REST URL and full-access database token. A local memory fallback is not shared.' };
  try {
    const url = new URL(credentials.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.hostname.endsWith('.upstash.io') || (url.port && url.port !== '443') || !['', '/'].includes(url.pathname)) {
      return { ...base, status: 'fail', code: 'redis.badUrl', message: 'Use the HTTPS REST endpoint from the Upstash database dashboard, without credentials or query parameters in the URL.' };
    }
    url.pathname = '/ping';
    const response = await fetchImpl(url.toString(), { method: 'GET',
      headers: { Authorization: `Bearer ${credentials.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error', cache: 'no-store' });
    if (!response.ok) return { ...base, status: 'fail', code: 'redis.httpError', params: { status: response.status }, message: `Redis authentication or connectivity failed (HTTP ${response.status}). Check the active database and matching token.` };
    const body = await response.json();
    return body?.result === 'PONG'
      ? { ...base, status: 'pass', code: 'redis.pass', message: 'The configured shared Redis endpoint answered an authenticated PING. This read-only check does not test rate-limit writes.' }
      : { ...base, status: 'fail', code: 'redis.badPing', message: 'Redis did not return a valid PING result. Check the endpoint and database state.' };
  } catch { return { ...base, status: 'fail', code: 'redis.unreachable', message: 'Redis could not be reached within the request limit. Check DNS, database state and the configured URL/token pair.' }; }
}

/** Explicit admin action only. Provider requests are read-only and never send mail. */
export async function runOperationsDiagnostics(options: {
  db?: DiagnosticDb; env?: Env; now?: Date; fetchImpl?: typeof fetch;
} = {}): Promise<OperationCheck[]> {
  const db = options.db ?? (await import('@/app/lib/prisma')).default;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  await db.backgroundJobState.upsert({ where: { name: OPERATIONS_READINESS_JOB },
    create: { name: OPERATIONS_READINESS_JOB, lastStartedAt: now }, update: { lastStartedAt: now } });
  const [database, resend, redis] = await Promise.all([
    bounded(db.$queryRaw`SELECT 1`).then((): OperationCheck => ({ id: 'database', label: 'Database', status: 'pass', code: 'database.pass', message: 'The configured database answered a read-only query.' }))
      .catch((): OperationCheck => ({ id: 'database', label: 'Database', status: 'fail', code: 'database.fail', message: 'Database check failed. Review the connection, credentials and provider status.' })),
    bounded(resendCheck(env, fetchImpl)).catch((): OperationCheck => ({ id: 'resend', label: 'Resend sender domain', status: 'fail', code: 'resend.timeout', message: 'Resend check timed out. Retry after checking provider availability.' })),
    bounded(redisCheck(env, fetchImpl)).catch((): OperationCheck => ({ id: 'redis', label: 'Shared Redis connection', status: 'fail', code: 'redis.timeout', message: 'Redis check timed out. Review the active database and endpoint.' })),
  ]);
  const checks = [...runtimeChecks(env), database, resend, redis];
  const passed = checks.every((check) => check.status === 'pass');
  const result = { lastStartedAt: now, ...(passed ? { lastSucceededAt: now, lastFailedAt: null } : { lastFailedAt: now }),
    lastError: passed ? null : 'One or more readiness checks need attention.', lastResultJson: JSON.stringify(checks) };
  await db.backgroundJobState.upsert({ where: { name: OPERATIONS_READINESS_JOB },
    create: { name: OPERATIONS_READINESS_JOB, ...result }, update: result });
  return checks;
}

/** Cached evidence only: safe to call inside the settings transaction. */
/**
 * `blockers` are English (logs, existing callers); `issues` are the same
 * reasons as codes for callers that show them in the admin's language.
 */
async function checkOperationsEvidence(db: ReadinessDb, now: Date, env: Env, requireRecent: boolean): Promise<{ ready: boolean; blockers: string[]; issues: ReadinessIssue[] }> {
  const failing = runtimeChecks(env).filter((check) => check.status !== 'pass');
  const blockers = failing.map((check) => check.message);
  const issues: ReadinessIssue[] = failing.map((check) => ({ code: check.code ?? check.id }));
  if (!resolveRedisCredentials(env)) {
    blockers.push('Configure shared Redis credentials before enabling booking.');
    issues.push({ code: 'blockers.redisMissing' });
  }
  const state = await db.backgroundJobState.findUnique({ where: { name: OPERATIONS_READINESS_JOB },
    select: { lastStartedAt: true, lastSucceededAt: true, lastFailedAt: true, lastResultJson: true } });
  const checks = parseOperationsChecks(state?.lastResultJson);
  const checkedAt = state?.lastSucceededAt?.getTime();
  if (!checkedAt || now.getTime() < checkedAt || (requireRecent && now.getTime() - checkedAt >= MAX_AGE_MS) ||
    (state?.lastStartedAt && state.lastStartedAt.getTime() > checkedAt) ||
    (state?.lastFailedAt && state.lastFailedAt.getTime() >= checkedAt) ||
    REQUIRED_CHECKS.some((id) => !checks.some((check) => check.id === id && check.status === 'pass')) ||
    checks.some((check) => check.status !== 'pass') ||
    checks.find((check) => check.id === 'configuration')?.fingerprint !== configurationFingerprint(env)) {
    blockers.push(requireRecent
      ? 'Run Operations diagnostics successfully with the current settings within the last 24 hours before enabling booking.'
      : 'Current runtime settings do not have a passing Operations report. Check provider settings and run diagnostics.');
    issues.push({ code: requireRecent ? 'blockers.reportRequired' : 'blockers.reportInvalid' });
  }
  return { ready: blockers.length === 0, blockers, issues };
}

/** Opening booking needs a fresh report; ongoing operation does not expire daily. */
export async function checkOperationsBookingReadiness(db: ReadinessDb, now = new Date(), env: Env = process.env) {
  return checkOperationsEvidence(db, now, env, true);
}

/** No network calls: reject missing/changed settings and failed diagnostic evidence. */
export async function checkOperationsRuntimeReadiness(db: ReadinessDb, now = new Date(), env: Env = process.env) {
  return checkOperationsEvidence(db, now, env, false);
}
