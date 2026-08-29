import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMarketplaces } from './marketplace-channels';

const none = { treatwellUrl: '', freshaUrl: '', booksyUrl: '' };

test('no marketplace URLs means no active marketplace', () => {
  assert.deepEqual(activeMarketplaces(none), []);
});

test('a marketplace is active exactly when its URL is set', () => {
  const r = activeMarketplaces({ ...none, freshaUrl: 'https://fresha.com/harbour' });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'Fresha');
  assert.equal(r[0].url, 'https://fresha.com/harbour');
});

test('a whitespace-only URL does not make a marketplace active', () => {
  // The admin form stores '' for a cleared field, but a stray space would
  // otherwise keep a switched-off channel alive on the public page.
  assert.deepEqual(activeMarketplaces({ ...none, treatwellUrl: '   ' }), []);
});

test('several active marketplaces come back in a stable order', () => {
  const r = activeMarketplaces({
    treatwellUrl: 'https://treatwell.co.uk/harbour',
    freshaUrl: 'https://fresha.com/harbour',
    booksyUrl: 'https://booksy.com/harbour',
  });
  assert.deepEqual(r.map((m) => m.name), ['Fresha', 'Treatwell', 'Booksy']);
});
