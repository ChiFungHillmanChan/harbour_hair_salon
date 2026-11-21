import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../../../next.config';

test('only the public 3D asset permits same-origin embedding', async () => {
  const rules = await config.headers!();
  const base = rules.find(rule => rule.source === '/(.*)')!;
  assert.equal(base.headers.find(header => header.key === 'X-Frame-Options')?.value, 'DENY');
  // Soft Next navigation retains the original document policy: the shared
  // policy must allow the same-origin scene when arriving from another page.
  // The Google map embed, Square's card fields and the bank's 3-D Secure
  // pages all come under https: (see square-csp.test.ts).
  assert.match(base.headers.find(header => header.key === 'Content-Security-Policy')!.value, /frame-src 'self' https:;/);
  const embedded = rules.find(rule => rule.source === '/harbour-hair-3d.html')!;
  assert.equal(embedded.headers.find(header => header.key === 'X-Frame-Options')?.value, 'SAMEORIGIN');
  assert.match(embedded.headers.find(header => header.key === 'Content-Security-Policy')!.value, /frame-ancestors 'self';/);
});
