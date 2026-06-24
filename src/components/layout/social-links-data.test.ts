import test from 'node:test';
import assert from 'node:assert/strict';
import { getSocialLinks } from './social-links-data';

test('returns only links whose URL is set, in IG/Treatwell/Google order', () => {
  const links = getSocialLinks({
    instagramUrl: 'https://instagram.com/x',
    treatwellUrl: 'https://treatwell.co.uk/x',
    googleBusinessUrl: 'https://maps.google.com/x',
  });
  assert.deepEqual(links.map((l) => l.key), ['instagram', 'treatwell', 'google']);
  assert.equal(links[0].href, 'https://instagram.com/x');
});

test('omits empty/whitespace URLs', () => {
  const links = getSocialLinks({ instagramUrl: '', treatwellUrl: '   ', googleBusinessUrl: 'https://maps.google.com/x' });
  assert.deepEqual(links.map((l) => l.key), ['google']);
});

test('every link has a non-empty human label', () => {
  const links = getSocialLinks({ instagramUrl: 'a', treatwellUrl: 'b', googleBusinessUrl: 'c' });
  for (const l of links) assert.ok(l.label.length > 0);
});
