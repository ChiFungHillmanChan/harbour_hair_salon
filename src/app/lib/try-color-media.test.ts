import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../../../next.config';

test('shared document policy permits local try-colour video without arbitrary remote media', async () => {
  const rules = await config.headers!();
  const base = rules.find(rule => rule.source === '/(.*)')!;
  const policy = base.headers.find(header => header.key === 'Content-Security-Policy')!.value;
  // Next soft navigation keeps the original document's CSP, so this allowance
  // must work when a visitor reaches try-colour from another public page.
  const media = policy.split(';').map(value => value.trim()).find(value => value.startsWith('media-src '));
  assert.ok(media, 'local video needs an explicit media policy');
  const sources = new Set(media.split(/\s+/).slice(1));
  assert.deepEqual(sources, new Set(["'self'", 'blob:']));
});
