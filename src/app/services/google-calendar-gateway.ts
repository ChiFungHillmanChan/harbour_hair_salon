import 'server-only';

// REST transport for the Google Calendar two-way sync
// (docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md §3):
// a service account signs a JWT (RS256) that Google exchanges for a short-lived
// access token, then plain REST calls with a timeout. No Google SDK. Never call
// this inside a database transaction.

import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import { googleCalendarConfig, type GoogleCalendarConfig } from '../lib/google-calendar-config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const LIST_PAGE_SIZE = 2500;
const MAX_LIST_PAGES = 10;
/** Google's own retry-later reasons, which it also sends with a 403. */
const USAGE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded']);

export class GoogleCalendarError extends Error {
  constructor(
    readonly kind: 'disabled' | 'auth' | 'not_found' | 'gone' | 'conflict' | 'retryable' | 'refused' | 'invalid_response',
    readonly status?: number,
  ) {
    super(`Google Calendar: ${kind}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'GoogleCalendarError';
  }
}

export type GoogleEvent = {
  id: string; status?: 'confirmed' | 'tentative' | 'cancelled'; summary?: string; description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  transparency?: 'opaque' | 'transparent'; colorId?: string; htmlLink?: string;
  extendedProperties?: { private?: Record<string, string> };
};

const eventTime = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() });
// Unknown fields (attendees, creator, links…) are dropped: only these leave the gateway.
const eventSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  start: eventTime.optional(),
  end: eventTime.optional(),
  transparency: z.enum(['opaque', 'transparent']).optional(),
  colorId: z.string().optional(),
  htmlLink: z.string().optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});
const listSchema = z.object({ items: z.array(eventSchema).optional(), nextPageToken: z.string().min(1).optional() });
const channelSchema = z.object({ resourceId: z.string().min(1), expiration: z.string().regex(/^\d{1,16}$/) });
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive().optional() });
const errorSchema = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string().optional() })).optional() }) });
/** An id is a URL path segment: nothing that could step out of it ("..", "/", "?"). */
const eventId = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/);

// Module-level cache of the short-lived access token only; the configuration
// (and so every credential) is read per call, never at import.
let cached: { key: string; token: string; expiresAt: number } | null = null;

export function resetGoogleTokenCacheForTests() {
  cached = null;
}

async function signAssertion(config: GoogleCalendarConfig, iat: number): Promise<string> {
  try {
    const key = await importPKCS8(config.privateKey, 'RS256');
    return await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(config.clientEmail).setAudience(TOKEN_URL).setIssuedAt(iat).setExpirationTime(iat + 3600)
      .sign(key);
  } catch {
    // An unreadable key is the website's own setup, never worth retrying.
    throw new GoogleCalendarError('auth');
  }
}

async function readJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new GoogleCalendarError('invalid_response');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new GoogleCalendarError('invalid_response');
  return result.data;
}

async function accessToken(config: GoogleCalendarConfig, transport: typeof fetch, now: () => number): Promise<string> {
  const cacheKey = config.clientEmail;
  if (cached && cached.key === cacheKey && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > now()) return cached.token;
  const assertion = await signAssertion(config, Math.floor(now() / 1000));
  let response: Response;
  try {
    response = await transport(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GoogleCalendarError('retryable');
  }
  if (!response.ok) {
    throw new GoogleCalendarError(response.status >= 500 || response.status === 429 ? 'retryable' : 'auth', response.status);
  }
  const body = await readJson(response, tokenSchema);
  cached = { key: cacheKey, token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

async function failureKind(response: Response): Promise<GoogleCalendarError['kind']> {
  const status = response.status;
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status === 408 || status === 429 || status >= 500) return 'retryable';
  if (status === 401) return 'auth';
  if (status === 403) {
    // Google answers usage limits with 403 as well as 429; those pass.
    const body = errorSchema.safeParse(await response.json().catch(() => null));
    const reasons = body.success ? body.data.error.errors ?? [] : [];
    return reasons.some(({ reason }) => reason !== undefined && USAGE_LIMIT_REASONS.has(reason)) ? 'retryable' : 'auth';
  }
  return 'refused';
}

function validEventId(id: string): string {
  if (!eventId.safeParse(id).success) throw new GoogleCalendarError('refused');
  return id;
}

/** Errors that mean "already gone": a delete or stop has nothing left to do. */
function alreadyGone(error: unknown): boolean {
  return error instanceof GoogleCalendarError && (error.kind === 'not_found' || error.kind === 'gone');
}

export function createGoogleCalendarGateway(deps: {
  loadConfig?: () => GoogleCalendarConfig | null;
  transport?: typeof fetch;
  now?: () => number;
} = {}) {
  const loadConfig = deps.loadConfig ?? (() => googleCalendarConfig());
  const transport = deps.transport ?? fetch;
  const now = deps.now ?? Date.now;

  /** `path` receives the encoded calendar prefix ("/calendars/{id}"). */
  async function request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: (calendar: string) => string, body?: unknown): Promise<Response> {
    // Read at operation time: switching sync off stops the very next call.
    const config = loadConfig();
    if (!config) throw new GoogleCalendarError('disabled');
    const token = await accessToken(config, transport, now);
    let response: Response;
    try {
      response = await transport(`${API_BASE}${path(`/calendars/${encodeURIComponent(config.calendarId)}`)}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GoogleCalendarError('retryable');
    }
    if (!response.ok) {
      // A rejected token must not be reused for the rest of its hour.
      if (response.status === 401 && cached?.token === token) cached = null;
      throw new GoogleCalendarError(await failureKind(response), response.status);
    }
    return response;
  }

  return {
    /** Writes the whole event at its id (PUT replaces every field). */
    async putEvent(event: GoogleEvent): Promise<GoogleEvent> {
      const id = validEventId(event.id);
      const response = await request('PUT', (calendar) => `${calendar}/events/${encodeURIComponent(id)}`, event);
      return readJson(response, eventSchema);
    },

    /** Creates the event with its own id; a 409 means that id already exists. */
    async insertEvent(event: GoogleEvent): Promise<GoogleEvent> {
      validEventId(event.id);
      const response = await request('POST', (calendar) => `${calendar}/events`, event);
      return readJson(response, eventSchema);
    },

    async deleteEvent(id: string): Promise<void> {
      validEventId(id);
      try {
        await request('DELETE', (calendar) => `${calendar}/events/${encodeURIComponent(id)}`);
      } catch (error) {
        if (!alreadyGone(error)) throw error;
      }
    },

    /**
     * Every event in the window, recurring ones expanded and deleted ones
     * included. Never returns part of a calendar: more than ten pages throws.
     */
    async listEvents(window: { timeMin: Date; timeMax: Date }): Promise<GoogleEvent[]> {
      const events: GoogleEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const query = new URLSearchParams({
          timeMin: window.timeMin.toISOString(),
          timeMax: window.timeMax.toISOString(),
          singleEvents: 'true',
          showDeleted: 'true',
          maxResults: String(LIST_PAGE_SIZE),
        });
        if (pageToken) query.set('pageToken', pageToken);
        const response = await request('GET', (calendar) => `${calendar}/events?${query}`);
        const body = await readJson(response, listSchema);
        events.push(...(body.items ?? []));
        if (!body.nextPageToken) return events;
        pageToken = body.nextPageToken;
      }
      throw new GoogleCalendarError('invalid_response');
    },

    /** Google may grant an earlier expiry than asked: the answer's is returned. */
    async watch(channel: { id: string; token: string; address: string; expiration: Date }): Promise<{ resourceId: string; expiration: Date }> {
      const response = await request('POST', (calendar) => `${calendar}/events/watch`, {
        id: channel.id,
        type: 'web_hook',
        address: channel.address,
        token: channel.token,
        expiration: String(channel.expiration.getTime()),
      });
      const body = await readJson(response, channelSchema);
      return { resourceId: body.resourceId, expiration: new Date(Number(body.expiration)) };
    },

    /** A channel Google no longer knows (expired) counts as stopped. */
    async stopChannel(channel: { id: string; resourceId: string }): Promise<void> {
      try {
        await request('POST', () => '/channels/stop', { id: channel.id, resourceId: channel.resourceId });
      } catch (error) {
        if (!alreadyGone(error)) throw error;
      }
    },
  };
}
