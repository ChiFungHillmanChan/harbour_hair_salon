import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonLdScript } from './json-ld';

test('jsonLdScript — neutralizes a </script> breakout in a string value', () => {
  const out = jsonLdScript({ comment: 'nice</script><script>alert(1)</script>' });
  assert.equal(out.includes('</script>'), false);
  assert.equal(out.includes('<script>'), false);
  assert.ok(out.includes('\\u003c')); // < escaped
  assert.ok(out.includes('\\u003e')); // > escaped
});

test('jsonLdScript — escapes ampersands', () => {
  const out = jsonLdScript({ name: 'Tom & Jerry' });
  assert.equal(out.includes(' & '), false);
  assert.ok(out.includes('\\u0026'));
});

test('jsonLdScript — output is still valid JSON that round-trips', () => {
  const data = { '@type': 'Review', body: 'a<b>c & d</e>' };
  const parsed = JSON.parse(jsonLdScript(data));
  assert.deepEqual(parsed, data);
});

test('jsonLdScript — leaves safe content unchanged in value', () => {
  const out = jsonLdScript({ name: 'Harbour Hair' });
  assert.equal(out, '{"name":"Harbour Hair"}');
});
