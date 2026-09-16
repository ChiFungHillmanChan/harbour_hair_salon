import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PUBLIC_OPENING_HOURS,
  formatRange,
  groupedOpeningHours,
  openingHoursSentence,
  openingHoursSpecification,
  shortDayRange,
} from './opening-hours-public';

test('publishes all seven days exactly once, in week order', () => {
  assert.deepEqual(
    PUBLIC_OPENING_HOURS.map((entry) => entry.day),
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  );
});

test('every day has 24-hour HH:MM times that open before they close', () => {
  for (const { day, opens, closes } of PUBLIC_OPENING_HOURS) {
    assert.match(opens, /^([01]\d|2[0-3]):[0-5]\d$/, `${day} opens`);
    assert.match(closes, /^([01]\d|2[0-3]):[0-5]\d$/, `${day} closes`);
    assert.ok(opens < closes, `${day} must open before it closes`);
  }
});

test('matches the salon\'s official hours (owner-confirmed 2026-09-16)', () => {
  // NAP consistency is the point of this module, but the OWNER is the source of
  // truth — not a marketplace listing. Treatwell currently says Mon-Sat
  // 10:15-19:00 / Sun 10:30-17:30, which is stale and is being corrected at the
  // source. This assertion is meant to fail and be updated deliberately,
  // together with Google Business Profile, Treatwell and the directories.
  const byDay = Object.fromEntries(PUBLIC_OPENING_HOURS.map((e) => [e.day, `${e.opens}-${e.closes}`]));
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    assert.equal(byDay[day], '10:00-19:00', `${day} must match the official hours`);
  }
});

test('collapses a uniform week into a single Mon-Sun group', () => {
  const groups = groupedOpeningHours();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].days.length, 7);
  assert.equal(shortDayRange(groups[0].days), 'Mon – Sun');
  // A single day must still render as one label, not a degenerate range.
  assert.equal(shortDayRange(['Sunday']), 'Sun');
});

test('emits schema.org OpeningHoursSpecification entries', () => {
  const spec = openingHoursSpecification();
  assert.equal(spec.length, 1);
  assert.equal(spec[0]['@type'], 'OpeningHoursSpecification');
  assert.equal(spec[0].dayOfWeek.length, 7);
  assert.equal(spec[0].opens, '10:00');
  assert.equal(spec[0].closes, '19:00');
});

test('formats a range and a sentence for reuse in copy', () => {
  assert.equal(formatRange('10:00', '19:00'), '10:00 – 19:00');
  assert.equal(
    openingHoursSentence(),
    'We are open Monday to Sunday from 10:00 to 19:00.',
  );
});

test('no page reintroduces its own copy of the opening hours', () => {
  // The drift this module exists to prevent: four separate hardcoded copies
  // that disagreed with each other and with the marketplace listings.
  const pages = [
    'src/app/page.tsx',
    'src/app/contact/page.tsx',
    'src/components/layout/Layout.tsx',
  ];
  for (const page of pages) {
    const source = readFileSync(join(process.cwd(), page), 'utf8');
    assert.doesNotMatch(
      source,
      /\b([01]\d|2[0-3]):[0-5]\d\s*(–|-|to)\s*([01]\d|2[0-3]):[0-5]\d/,
      `${page} must render hours from opening-hours-public, not inline literals`,
    );
    assert.doesNotMatch(
      source,
      /'@type':\s*'OpeningHoursSpecification'/,
      `${page} must call openingHoursSpecification() rather than build the spec inline`,
    );
  }
});
