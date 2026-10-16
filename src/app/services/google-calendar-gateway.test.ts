import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import type { GoogleCalendarConfig } from '../lib/google-calendar-config';
import {
  createGoogleCalendarGateway, GoogleCalendarError, resetGoogleTokenCacheForTests, type GoogleEvent,
} from './google-calendar-gateway';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const config: GoogleCalendarConfig = {
  calendarId: 'abc123@group.calendar.google.com',
  clientEmail: 'sync@harbour.iam.gserviceaccount.com',
  privateKey,
  webhookSecret: 'webhook-secret',
};
const CALENDAR = `${API}/calendars/${encodeURIComponent(config.calendarId)}`;
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const event: GoogleEvent = {
  id: 'hh0123456789abcdef0123456789abcdef01234567',
  status: 'confirmed',
  summary: 'Ivan · Jane · Haircut',
  start: { dateTime: '2026-10-20T10:00:00+01:00', timeZone: 'Europe/London' },
  end: { dateTime: '2026-10-20T11:00:00+01:00', timeZone: 'Europe/London' },
  transparency: 'opaque',
  colorId: '1',
  extendedProperties: { private: { harbourAppointmentId: 'appt-1' } },
};

type Call = { url: string; init: RequestInit };
type Reply = Response | (() => Response) | Error;

function harness(options: {
  api?: (call: Call, index: number) => Reply;
  token?: (index: number) => Reply;
  settings?: GoogleCalendarConfig | null;
} = {}) {
  const calls: Call[] = [];
  const tokenCalls: Call[] = [];
  const apiCalls: Call[] = [];
  let clock = T0;
  const settle = (reply: Reply) => {
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply() : reply;
  };
  const gateway = createGoogleCalendarGateway({
    loadConfig: () => (options.settings === undefined ? config : options.settings),
    now: () => clock,
    transport: async (url, init) => {
      const call = { url: String(url), init: init ?? {} };
      calls.push(call);
      if (call.url === TOKEN_URL) {
        tokenCalls.push(call);
        return settle(options.token?.(tokenCalls.length - 1)
          ?? Response.json({ access_token: `token-${tokenCalls.length}`, expires_in: 3600, token_type: 'Bearer' }));
      }
      apiCalls.push(call);
      return settle(options.api?.(call, apiCalls.length - 1) ?? Response.json(event));
    },
  });
  return { gateway, calls, tokenCalls, apiCalls, setClock: (ms: number) => { clock = ms; } };
}

const isKind = (kind: GoogleCalendarError['kind'], status?: number) => (error: unknown) =>
  error instanceof GoogleCalendarError && error.kind === kind && error.status === status;
const auth = (call: Call) => new Headers(call.init.headers).get('Authorization');
const status = (code: number, body: unknown = { error: { code } }) => () => Response.json(body, { status: code });

beforeEach(() => resetGoogleTokenCacheForTests());

test('disabled gateway never sends anything', async () => {
  const { gateway, calls } = harness({ settings: null });
  await assert.rejects(gateway.putEvent(event), isKind('disabled'));
  await assert.rejects(gateway.listEvents({ timeMin: new Date(T0), timeMax: new Date(T0 + 1) }), isKind('disabled'));
  assert.equal(calls.length, 0);
});

test('first call exchanges a signed service-account JWT for an access token', async () => {
  const { gateway, tokenCalls } = harness();
  await gateway.putEvent(event);
  assert.equal(tokenCalls.length, 1);
  const { init } = tokenCalls[0];
  assert.equal(init.method, 'POST');
  assert.equal(new Headers(init.headers).get('Content-Type'), 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(String(init.body));
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const assertion = form.get('assertion') ?? '';
  assert.deepEqual(decodeProtectedHeader(assertion), { alg: 'RS256', typ: 'JWT' });
  const claims = decodeJwt(assertion);
  assert.equal(claims.iss, config.clientEmail);
  assert.equal(claims.scope, SCOPE);
  assert.equal(claims.aud, TOKEN_URL);
  assert.equal(claims.iat, T0 / 1000);
  assert.equal((claims.exp ?? 0) - (claims.iat ?? 0), 3600);
  // Signed with the service account's key, verifiable with its public half.
  await jwtVerify(assertion, await importSPKI(publicKey, 'RS256'), {
    issuer: config.clientEmail, audience: TOKEN_URL, currentDate: new Date(T0),
  });
});

test('the access token is reused until 60 seconds before it expires', async () => {
  const { gateway, tokenCalls, apiCalls, setClock } = harness();
  await gateway.putEvent(event);
  setClock(T0 + 3_540_000 - 1);
  await gateway.putEvent(event);
  assert.equal(tokenCalls.length, 1);
  assert.equal(auth(apiCalls[1]), 'Bearer token-1');
  setClock(T0 + 3_540_000);
  await gateway.putEvent(event);
  assert.equal(tokenCalls.length, 2);
  assert.equal(auth(apiCalls[2]), 'Bearer token-2');
});

test('a 401 from the API drops the cached token so the next call signs in again', async () => {
  const { gateway, tokenCalls, apiCalls } = harness({ api: (_call, index) => (index === 0 ? status(401)() : Response.json(event)) });
  await assert.rejects(gateway.putEvent(event), isKind('auth', 401));
  await gateway.putEvent(event);
  assert.equal(tokenCalls.length, 2);
  assert.equal(auth(apiCalls[1]), 'Bearer token-2');
});

test('token endpoint failures: refused → auth, 429/5xx/network → retryable, junk → invalid_response', async () => {
  for (const [reply, kind, code] of [
    [status(400, { error: 'invalid_grant' }), 'auth', 400],
    [status(401), 'auth', 401],
    [status(429), 'retryable', 429],
    [status(503), 'retryable', 503],
    [new TypeError('network down'), 'retryable', undefined],
    [() => Response.json({ token_type: 'Bearer' }), 'invalid_response', undefined],
    [() => new Response('not json', { status: 200 }), 'invalid_response', undefined],
  ] as const) {
    resetGoogleTokenCacheForTests();
    const { gateway, apiCalls } = harness({ token: () => reply });
    await assert.rejects(gateway.putEvent(event), isKind(kind, code), `${kind} ${code}`);
    assert.equal(apiCalls.length, 0);
  }
});

test('an unreadable private key is an auth (setup) problem and sends nothing', async () => {
  const { gateway, calls } = harness({ settings: { ...config, privateKey: '-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----' } });
  await assert.rejects(gateway.putEvent(event), isKind('auth'));
  assert.equal(calls.length, 0);
});

test('no fragment of the private key ever appears in an error: bad keys and failed token requests', async () => {
  const body = privateKey.split('\n').filter((line) => line && !line.startsWith('-----'));
  const fragments = ['BEGIN PRIVATE KEY', 'PRIVATE KEY-----', 'BEGIN RSA PRIVATE KEY', body[0].slice(0, 24), body[1].slice(8, 32), body.at(-1)!.slice(0, 16), 'nope'];
  const leaks = (error: unknown) => {
    const seen = error instanceof Error ? [error.message, String(error), error.stack ?? '', String(error.cause ?? '')] : [String(error)];
    return fragments.filter((fragment) => seen.some((text) => text.includes(fragment)));
  };
  const badKeys = [
    '-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----',
    // A real key cut short, and the same key in the wrong (PKCS#1) wrapper.
    `${privateKey.slice(0, 300)}\n-----END PRIVATE KEY-----`,
    privateKey.replace(/BEGIN PRIVATE KEY/, 'BEGIN RSA PRIVATE KEY').replace(/END PRIVATE KEY/, 'END RSA PRIVATE KEY'),
    body.join(''),
  ];
  for (const key of badKeys) {
    resetGoogleTokenCacheForTests();
    const { gateway } = harness({ settings: { ...config, privateKey: key } });
    const error = await gateway.putEvent(event).then(() => null, (thrown: unknown) => thrown);
    assert.ok(isKind('auth')(error), key.slice(0, 40));
    assert.deepEqual(leaks(error), [], 'bad key');
  }
  for (const reply of [
    status(400, { error: 'invalid_grant', error_description: `Invalid JWT Signature. ${body[0]}` }),
    status(401),
    status(503),
    new TypeError(`network down ${body[1]}`),
    () => new Response(`not json ${privateKey}`, { status: 200 }),
  ]) {
    resetGoogleTokenCacheForTests();
    const { gateway } = harness({ token: () => reply });
    const error = await gateway.putEvent(event).then(() => null, (thrown: unknown) => thrown);
    assert.ok(error instanceof GoogleCalendarError);
    assert.deepEqual(leaks(error), [], 'failed token request');
  }
});

test('putEvent PUTs the whole event to its id with the bearer token', async () => {
  const { gateway, apiCalls } = harness({ api: () => Response.json({ ...event, etag: '"1"', htmlLink: 'https://calendar.google.com/x' }) });
  const result = await gateway.putEvent(event);
  assert.deepEqual(result, event);
  assert.equal(apiCalls[0].url, `${CALENDAR}/events/${event.id}`);
  assert.equal(apiCalls[0].init.method, 'PUT');
  assert.equal(auth(apiCalls[0]), 'Bearer token-1');
  assert.equal(new Headers(apiCalls[0].init.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(String(apiCalls[0].init.body)), event);
});

test('insertEvent POSTs the event, id included, to the calendar', async () => {
  const { gateway, apiCalls } = harness();
  assert.deepEqual(await gateway.insertEvent(event), event);
  assert.equal(apiCalls[0].url, `${CALENDAR}/events`);
  assert.equal(apiCalls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(apiCalls[0].init.body)), event);
});

test('every request is uncached, refuses redirects and has a timeout', async () => {
  const { gateway, calls } = harness();
  await gateway.putEvent(event);
  assert.equal(calls.length, 2);
  for (const { init } of calls) {
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test('API status codes map to typed errors', async () => {
  for (const [code, kind] of [
    [404, 'not_found'], [409, 'conflict'], [410, 'gone'], [401, 'auth'], [403, 'auth'],
    [429, 'retryable'], [500, 'retryable'], [502, 'retryable'], [503, 'retryable'],
    [400, 'refused'], [412, 'refused'], [422, 'refused'],
  ] as const) {
    resetGoogleTokenCacheForTests();
    const { gateway } = harness({ api: () => status(code)() });
    await assert.rejects(gateway.putEvent(event), isKind(kind, code), `${code} → ${kind}`);
  }
});

test('a 403 is auth unless Google says it is a usage limit', async () => {
  for (const [reason, kind] of [
    ['rateLimitExceeded', 'retryable'], ['userRateLimitExceeded', 'retryable'],
    ['dailyLimitExceeded', 'retryable'], ['quotaExceeded', 'retryable'],
    ['forbidden', 'auth'], ['requiredAccessLevel', 'auth'],
  ] as const) {
    resetGoogleTokenCacheForTests();
    const { gateway } = harness({ api: () => status(403, { error: { code: 403, errors: [{ domain: 'usageLimits', reason }] } })() });
    await assert.rejects(gateway.putEvent(event), isKind(kind, 403), reason);
  }
  resetGoogleTokenCacheForTests();
  const { gateway } = harness({ api: () => new Response('Forbidden', { status: 403 }) });
  await assert.rejects(gateway.putEvent(event), isKind('auth', 403));
});

test('a timeout or network failure is retryable', async () => {
  const timeout = new DOMException('The operation timed out.', 'TimeoutError');
  for (const failure of [timeout, new TypeError('fetch failed')]) {
    resetGoogleTokenCacheForTests();
    const { gateway } = harness({ api: () => failure });
    await assert.rejects(gateway.insertEvent(event), isKind('retryable'));
  }
});

test('a response that is not an event is invalid_response', async () => {
  for (const body of [{ kind: 'calendar#event' }, { id: 7 }, { id: 'x', status: 'exploded' }]) {
    resetGoogleTokenCacheForTests();
    const { gateway } = harness({ api: () => Response.json(body) });
    await assert.rejects(gateway.putEvent(event), isKind('invalid_response'), JSON.stringify(body));
  }
  resetGoogleTokenCacheForTests();
  const { gateway } = harness({ api: () => new Response('<html>', { status: 200 }) });
  await assert.rejects(gateway.putEvent(event), isKind('invalid_response'));
});

test('an event id that could escape its URL segment is refused before any request', async () => {
  const { gateway, calls } = harness();
  for (const id of ['', '..', 'a/b', 'a?b', 'a b']) {
    await assert.rejects(gateway.putEvent({ ...event, id }), isKind('refused'), id);
    await assert.rejects(gateway.deleteEvent(id), isKind('refused'), id);
  }
  assert.equal(calls.length, 0);
});

test('deleteEvent DELETEs and treats 404 and 410 as already gone', async () => {
  const { gateway, apiCalls } = harness({ api: () => new Response(null, { status: 204 }) });
  await gateway.deleteEvent(event.id);
  assert.equal(apiCalls[0].url, `${CALENDAR}/events/${event.id}`);
  assert.equal(apiCalls[0].init.method, 'DELETE');
  for (const code of [404, 410]) {
    resetGoogleTokenCacheForTests();
    const { gateway: again } = harness({ api: () => status(code)() });
    await again.deleteEvent(event.id);
  }
  resetGoogleTokenCacheForTests();
  const { gateway: failing } = harness({ api: () => status(503)() });
  await assert.rejects(failing.deleteEvent(event.id), isKind('retryable', 503));
});

test('listEvents asks for single, deleted-included events in the window and follows two pages', async () => {
  const second: GoogleEvent = { id: 'googleid123_20261021T090000Z', status: 'cancelled' };
  const { gateway, apiCalls } = harness({
    api: (_call, index) => Response.json(index === 0
      ? { kind: 'calendar#events', items: [event], nextPageToken: 'page-2' }
      : { kind: 'calendar#events', items: [second], nextSyncToken: 'sync' }),
  });
  const timeMin = new Date(T0 - 86_400_000);
  const timeMax = new Date(T0 + 90 * 86_400_000);
  assert.deepEqual(await gateway.listEvents({ timeMin, timeMax }), [event, second]);
  assert.equal(apiCalls.length, 2);
  for (const [index, call] of apiCalls.entries()) {
    const url = new URL(call.url);
    assert.equal(`${url.origin}${url.pathname}`, `${CALENDAR}/events`);
    assert.equal(call.init.method, 'GET');
    assert.equal(url.searchParams.get('timeMin'), timeMin.toISOString());
    assert.equal(url.searchParams.get('timeMax'), timeMax.toISOString());
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.equal(url.searchParams.get('showDeleted'), 'true');
    assert.equal(url.searchParams.get('maxResults'), '2500');
    assert.equal(url.searchParams.get('pageToken'), index === 0 ? null : 'page-2');
  }
});

test('listEvents accepts a page without items', async () => {
  const { gateway } = harness({ api: () => Response.json({ kind: 'calendar#events' }) });
  assert.deepEqual(await gateway.listEvents({ timeMin: new Date(T0), timeMax: new Date(T0 + 1) }), []);
});

test('listEvents stops after 10 pages rather than return a partial calendar', async () => {
  const { gateway, apiCalls } = harness({ api: (_call, index) => Response.json({ items: [], nextPageToken: `page-${index + 2}` }) });
  await assert.rejects(gateway.listEvents({ timeMin: new Date(T0), timeMax: new Date(T0 + 1) }), isKind('invalid_response'));
  assert.equal(apiCalls.length, 10);
});

test('watch registers a web_hook channel and returns its resource and real expiry', async () => {
  const expiration = new Date(T0 + 7 * 86_400_000);
  const granted = T0 + 6 * 86_400_000;
  const { gateway, apiCalls } = harness({
    api: () => Response.json({ kind: 'api#channel', id: 'channel-1', resourceId: 'resource-1', resourceUri: 'x', token: 'tok', expiration: String(granted) }),
  });
  const result = await gateway.watch({ id: 'channel-1', token: 'tok', address: 'https://www.harbourhair.co.uk/api/webhooks/google-calendar', expiration });
  assert.deepEqual(result, { resourceId: 'resource-1', expiration: new Date(granted) });
  assert.equal(apiCalls[0].url, `${CALENDAR}/events/watch`);
  assert.equal(apiCalls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(apiCalls[0].init.body)), {
    id: 'channel-1', type: 'web_hook', address: 'https://www.harbourhair.co.uk/api/webhooks/google-calendar',
    token: 'tok', expiration: String(expiration.getTime()),
  });
});

test('watch without a resource id or expiry in the answer is invalid_response', async () => {
  for (const body of [{ id: 'channel-1', expiration: '1' }, { id: 'channel-1', resourceId: 'r' }, { resourceId: 'r', expiration: 'soon' }]) {
    resetGoogleTokenCacheForTests();
    const { gateway } = harness({ api: () => Response.json(body) });
    await assert.rejects(
      gateway.watch({ id: 'channel-1', token: 't', address: 'https://example.test/hook', expiration: new Date(T0) }),
      isKind('invalid_response'), JSON.stringify(body),
    );
  }
});

test('stopChannel POSTs to channels/stop; an unknown channel is already stopped', async () => {
  const { gateway, apiCalls } = harness({ api: () => new Response(null, { status: 204 }) });
  await gateway.stopChannel({ id: 'channel-1', resourceId: 'resource-1' });
  assert.equal(apiCalls[0].url, `${API}/channels/stop`);
  assert.equal(apiCalls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(apiCalls[0].init.body)), { id: 'channel-1', resourceId: 'resource-1' });
  resetGoogleTokenCacheForTests();
  const { gateway: expired } = harness({ api: () => status(404)() });
  await expired.stopChannel({ id: 'channel-1', resourceId: 'resource-1' });
  resetGoogleTokenCacheForTests();
  const { gateway: failing } = harness({ api: () => status(403)() });
  await assert.rejects(failing.stopChannel({ id: 'channel-1', resourceId: 'resource-1' }), isKind('auth', 403));
});

test('config is read per call, so turning sync off stops the next request', async () => {
  let settings: GoogleCalendarConfig | null = config;
  const calls: string[] = [];
  const gateway = createGoogleCalendarGateway({
    loadConfig: () => settings,
    now: () => T0,
    transport: async (url) => {
      calls.push(String(url));
      return String(url) === TOKEN_URL ? Response.json({ access_token: 't', expires_in: 3600 }) : Response.json(event);
    },
  });
  await gateway.putEvent(event);
  settings = null;
  await assert.rejects(gateway.putEvent(event), isKind('disabled'));
  assert.equal(calls.length, 2);
});
