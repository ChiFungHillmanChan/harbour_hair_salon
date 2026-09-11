import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';
import { CalendarFeedError } from './calendar-ical';

export const MAX_CALENDAR_FEED_BYTES = 2 * 1024 * 1024;
const FEED_TIMEOUT_MS = 8_000;
type Address = { address: string; family: number };
type Resolve = (hostname: string) => Promise<Address[]>;

export function isPublicCalendarAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  const blocked = new BlockList();
  if (family === 4) {
    for (const [ip, prefix] of [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['192.88.99.0', 24], ['198.18.0.0', 15],
      ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ] as const) blocked.addSubnet(ip, prefix, 'ipv4');
    return !blocked.check(address, 'ipv4');
  }
  // Only global unicast IPv6. This also refuses mapped IPv4 and translation
  // prefixes, which must never bypass the IPv4 private-address rules.
  const global = new BlockList();
  global.addSubnet('2000::', 3, 'ipv6');
  blocked.addSubnet('2001::', 23, 'ipv6'); // special-purpose allocation
  blocked.addSubnet('2001:db8::', 32, 'ipv6');
  blocked.addSubnet('2002::', 16, 'ipv6'); // 6to4 embeds arbitrary IPv4
  blocked.addSubnet('3fff::', 20, 'ipv6'); // documentation
  return global.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function validateCalendarFeedUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new CalendarFeedError('Enter a valid HTTPS calendar feed URL.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (value.length > 4_096 || url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || !host ||
      /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
      (!host.includes('.') && !isIP(host)) || (isIP(host) && !isPublicCalendarAddress(host))) {
    throw new CalendarFeedError('Use a public HTTPS calendar URL without credentials, fragments or custom ports.');
  }
  return url;
}

/** Resolve every answer and pin one; a second DNS lookup cannot rebind it. */
export async function resolveCalendarFeedAddress(
  url: URL,
  resolve: Resolve = (hostname) => lookup(hostname, { all: true, verbatim: true }),
): Promise<Address> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname);
  if (!addresses.length || addresses.some((entry) => !isPublicCalendarAddress(entry.address))) {
    throw new CalendarFeedError('Calendar hostname must resolve only to public addresses.');
  }
  return addresses[0];
}

/**
 * HTTPS with DNS pinning, normal certificate checks and an end-to-end deadline.
 * Redirects are refused, including HTTPS-to-HTTPS: save the final feed URL.
 * Stream size is enforced even without Content-Length. Errors omit secrets.
 */
export async function fetchCalendarFeed(value: string, deps: { resolve?: Resolve; request?: typeof request; timeoutMs?: number } = {}): Promise<string> {
  const url = validateCalendarFeedUrl(value);
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FEED_TIMEOUT_MS);
  try {
    const address = await new Promise<Address>((resolve, reject) => {
      const abort = () => reject(new CalendarFeedError('Calendar feed timed out.'));
      signal.addEventListener('abort', abort, { once: true });
      resolveCalendarFeedAddress(url, deps.resolve).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    return await new Promise<string>((resolve, reject) => {
      const req = (deps.request ?? request)(url, {
        method: 'GET', agent: false, signal,
        headers: { Accept: 'text/calendar', 'Accept-Encoding': 'identity' },
        lookup: (_hostname, options, callback) => {
          // Newer Node requests may ask for all addresses, older ones for one.
          if (options.all) callback(null, [address] as never);
          else callback(null, address.address, address.family);
        },
      }, (response) => {
        const status = response.statusCode ?? 0;
        const fail = (message: string) => {
          response.destroy();
          reject(new CalendarFeedError(message));
        };
        if (status >= 300 && status < 400) return fail('Calendar feed redirected. Save its final HTTPS feed URL.');
        if (status !== 200) return fail(`Calendar feed returned HTTP ${status}.`);
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          return fail('Compressed calendar feeds are unsupported.');
        }
        if (Number(response.headers['content-length']) > MAX_CALENDAR_FEED_BYTES) return fail('Calendar feed is too large.');
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_CALENDAR_FEED_BYTES) fail('Calendar feed is too large.');
          else chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        response.on('error', () => reject(new CalendarFeedError('Calendar feed connection failed.')));
      });
      req.on('error', () => reject(new CalendarFeedError(signal.aborted ? 'Calendar feed timed out.' : 'Calendar feed connection failed.')));
      req.end();
    });
  } catch (error) {
    if (error instanceof CalendarFeedError) throw error;
    throw new CalendarFeedError('Calendar feed could not be reached.');
  }
}
