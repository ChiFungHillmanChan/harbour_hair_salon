import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../../../next.config';

const SQUARE_SDK = ['https://web.squarecdn.com', 'https://sandbox.web.squarecdn.com'];
const SQUARE_FONTS = ['https://square-fonts-production-f.squarecdn.com', 'https://d1g145x70srn7h.cloudfront.net'];

async function documentPolicy(source: string): Promise<Map<string, string[]>> {
  const rules = await config.headers!();
  const policy = rules.find((rule) => rule.source === source)!.headers.find((header) => header.key === 'Content-Security-Policy')!.value;
  return new Map(policy.split(';').map((directive) => directive.trim()).filter(Boolean).map((directive) => {
    const [name, ...sources] = directive.split(/\s+/);
    return [name, sources] as const;
  }));
}

test('the document policy lets the Square Web Payments SDK load its script, card frames, styles and fonts', async () => {
  // The 3D walkthrough asset extends the same policy, so both are checked.
  for (const source of ['/(.*)', '/harbour-hair-3d.html']) {
    const csp = await documentPolicy(source);
    for (const directive of ['script-src', 'script-src-elem', 'frame-src', 'style-src']) {
      for (const origin of SQUARE_SDK) assert.ok(csp.get(directive)?.includes(origin), `${source} ${directive} ${origin}`);
    }
    for (const origin of SQUARE_FONTS) assert.ok(csp.get('font-src')?.includes(origin), `${source} font-src ${origin}`);
    // Square's payment API calls need no entry of their own.
    assert.ok(csp.get('connect-src')?.includes('https:'));
  }
});

test('Square is allowed narrowly: exact hosts only, and nowhere it is not needed', async () => {
  const csp = await documentPolicy('/(.*)');
  for (const [directive, sources] of csp) {
    assert.equal(sources.some((value) => value.includes('*')), false, `no wildcard host in ${directive}`);
  }
  assert.deepEqual(csp.get('default-src'), ["'self'"]);
  for (const directive of ['img-src', 'media-src', 'worker-src', 'connect-src']) {
    assert.equal(csp.get(directive)?.some((value) => value.includes('square') || value.includes('cloudfront')), false, directive);
  }
  assert.equal(csp.get('font-src')?.some((value) => SQUARE_SDK.includes(value)), false, 'the SDK CDNs serve no fonts');
});
