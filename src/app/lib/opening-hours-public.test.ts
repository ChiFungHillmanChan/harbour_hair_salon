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

test('matches the hours published on Treatwell (verified 2026-09-16)', () => {
  // NAP consistency is the point of this module: if the salon changes its hours
  // the marketplace listings must change with it, so this assertion is meant to
  // fail and be updated deliberately, together with Google and Treatwell.
  const byDay = Object.fromEntries(PUBLIC_OPENING_HOURS.map((e) => [e.day, `${e.opens}-${e.closes}`]));
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
    assert.equal(byDay[day], '10:15-19:00', `${day} must match Treatwell`);
  }
  assert.equal(byDay.Sunday, '10:30-17:30', 'Sunday must match Treatwell');
});

test('groups consecutive identical days and keeps Sunday separate', () => {
  const groups = groupedOpeningHours();
  assert.equal(groups.length, 2);
  assert.equal(groups[0].days.length, 6);
  assert.deepEqual(groups[1].days, ['Sunday']);
  assert.equal(shortDayRange(groups[0].days), 'Mon – Sat');
  assert.equal(shortDayRange(groups[1].days), 'Sun');
});

test('emits schema.org OpeningHoursSpecification entries', () => {
  const spec = openingHoursSpecification();
  assert.equal(spec.length, 2);
  assert.equal(spec[0]['@type'], 'OpeningHoursSpecification');
  assert.equal(spec[0].dayOfWeek.length, 6);
  assert.equal(spec[0].opens, '10:15');
  assert.equal(spec[1].dayOfWeek[0], 'Sunday');
  assert.equal(spec[1].closes, '17:30');
});

test('formats a range and a sentence for reuse in copy', () => {
  assert.equal(formatRange('10:15', '19:00'), '10:15 – 19:00');
  assert.equal(
    openingHoursSentence(),
    'We are open Monday to Saturday from 10:15 to 19:00, and on Sunday from 10:30 to 17:30.',
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
