import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Treatwell is being switched off. While `/book` fell back to a hardcoded
// Treatwell URL, clearing the field in Admin -> Site Settings did NOT remove
// the button — so the salon had no way to stop sending customers to a dead
// channel without a redeploy. Nothing marketplace-specific may be baked in.

const root = join(process.cwd(), 'src');

test('no marketplace URL is hardcoded in the booking-maintenance module', () => {
  const source = readFileSync(join(root, 'app/lib/booking-maintenance.ts'), 'utf8');
  assert.doesNotMatch(source, /https?:\/\/[^\s'"]*(treatwell|fresha|booksy)/i);
});

test('the refusal message names no marketplace', () => {
  // It is returned by submitBooking/requestReschedule, which cannot know
  // which marketplaces are live — that lives in settings.
  const source = readFileSync(join(root, 'app/lib/booking-maintenance.ts'), 'utf8');
  const message = source.match(/BOOKING_MAINTENANCE_MESSAGE\s*=\s*([\s\S]*?);/)?.[1] ?? '';
  assert.notEqual(message, '');
  assert.doesNotMatch(message, /treatwell|fresha|booksy/i);
});

test('/book renders marketplace links from settings, not from a constant', () => {
  const source = readFileSync(join(root, 'app/[locale]/book/page.tsx'), 'utf8');
  assert.match(source, /activeMarketplaces\(/, 'must derive the links from settings');
  assert.doesNotMatch(source, /TREATWELL_BOOKING_URL/);
});
