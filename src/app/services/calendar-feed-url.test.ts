import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCalendarFeedUrl, resolveCalendarFeedAddress, isPublicCalendarAddress } from './calendar-feed-url';

test('calendar URLs require HTTPS, no credentials, fragments or custom ports', () => {
  assert.equal(validateCalendarFeedUrl('https://feeds.example.com/staff.ics?token=secret').hostname, 'feeds.example.com');
  for (const url of ['http://feeds.example.com/a', 'https://user:pass@example.com/a', 'https://example.com:8443/a', 'https://example.com/a#secret', 'https://localhost/a', 'https://metadata.google.internal/a', 'file:///etc/passwd']) {
    assert.throws(() => validateCalendarFeedUrl(url));
  }
});
test('non-public IPv4, IPv6 and IPv4-mapped IPv6 addresses are rejected', () => {
  for (const ip of ['127.0.0.1', '0.0.0.0', '10.1.1.1', '172.16.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '224.1.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) {
    assert.equal(isPublicCalendarAddress(ip), false, ip);
  }
  assert.equal(isPublicCalendarAddress('1.1.1.1'), true);
  assert.equal(isPublicCalendarAddress('2606:4700:4700::1111'), true);
});
test('DNS must resolve exclusively to public addresses before pinning one to the request', async () => {
  await assert.rejects(resolveCalendarFeedAddress(new URL('https://feeds.example.com/a'), async () => [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }]), /public/i);
  assert.deepEqual(await resolveCalendarFeedAddress(new URL('https://feeds.example.com/a'), async () => [{ address: '1.1.1.1', family: 4 }]), { address: '1.1.1.1', family: 4 });
});

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { request } from 'node:https';
import { fetchCalendarFeed, MAX_CALENDAR_FEED_BYTES } from './calendar-feed-url';
function transport(statusCode: number, chunks: Buffer[], headers: Record<string, string> = {}): typeof request {
  return ((_url: URL, options: { lookup: (name: string, opts: object, callback: (err: null, address: string, family: number) => void) => void }, callback: (response: unknown) => void) => {
    options.lookup('feeds.example.com', {}, (err, address, family) => { assert.equal(err, null); assert.equal(address, '1.1.1.1'); assert.equal(family, 4); });
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => { const response = Object.assign(Readable.from(chunks), { statusCode, headers }); callback(response); };
    return req;
  }) as unknown as typeof request;
}
const resolve = async () => [{ address: '1.1.1.1', family: 4 }];
test('transport pins validated DNS and consumes a bounded successful stream', async () => {
  const text = await fetchCalendarFeed('https://feeds.example.com/a?token=secret', { resolve, request: transport(200, [Buffer.from('calendar')]) });
  assert.equal(text, 'calendar');
});
test('redirects are rejected and response size limits apply without Content-Length', async () => {
  await assert.rejects(fetchCalendarFeed('https://feeds.example.com/a', { resolve, request: transport(302, [], { location: 'http://127.0.0.1/secret' }) }), /redirect/i);
  await assert.rejects(fetchCalendarFeed('https://feeds.example.com/a', { resolve, request: transport(200, [Buffer.alloc(MAX_CALENDAR_FEED_BYTES + 1)]) }), /too large/i);
  await assert.rejects(fetchCalendarFeed('https://feeds.example.com/a', { resolve, request: transport(200, [], { 'content-length': String(MAX_CALENDAR_FEED_BYTES + 1) }) }), /too large/i);
});
test('the deadline includes DNS resolution and never reaches HTTP after DNS times out', async () => {
  const keepAlive = setTimeout(() => {}, 500);
  try {
    await assert.rejects(fetchCalendarFeed('https://feeds.example.com/a', { timeoutMs: 10, resolve: async () => new Promise(() => {}), request: (() => { throw new Error('must not request'); }) as typeof request }), /timed out/i);
  } finally { clearTimeout(keepAlive); }
});
