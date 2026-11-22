import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openState, describeOpen, dayHours, openOn, openAt, placeNow,
} from '../lib/openingHours.js';

// Tokyo, UTC+9.
const JST = 540;
// A UTC instant for a Tokyo weekday and time. 2026-12-13 is a Sunday.
const tokyo = (date, hh, mm = 0) => Date.UTC(...date.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), hh, mm) - JST * 60000;

const shop = {
  // Monday to Saturday 11:00–20:00, shut Sundays.
  periods: [1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 11, minute: 0 }, close: { day, hour: 20, minute: 0 } })),
};
const bar = {
  // Every night 18:00 to 05:00 the next morning (Albatross G's real hours).
  periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 18, minute: 0 }, close: { day: (day + 1) % 7, hour: 5, minute: 0 } })),
};
const always = { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] };
// Open till midnight and again from midnight: one stretch, not a close at twelve.
const late = {
  periods: [
    { open: { day: 1, hour: 10, minute: 0 }, close: { day: 2, hour: 0, minute: 0 } },
    { open: { day: 2, hour: 0, minute: 0 }, close: { day: 2, hour: 2, minute: 0 } },
  ],
};

test('placeNow reads the place clock, not the reader\'s', () => {
  assert.deepEqual(placeNow(JST, tokyo('2026-12-14', 12, 30)), { day: 1, minute: 750 });
});

test('a shop open now says when it closes', () => {
  const s = openState(shop, JST, tokyo('2026-12-14', 12, 30)); // Monday 12:30
  assert.equal(s.open, true);
  assert.deepEqual([s.next.day, s.next.minute], [1, 20 * 60]);
  assert.equal(describeOpen(s, 1), 'Open · closes 8pm');
});

test('a shop shut on Sunday opens on Monday', () => {
  const s = openState(shop, JST, tokyo('2026-12-13', 15)); // Sunday 15:00
  assert.equal(s.open, false);
  assert.equal(describeOpen(s, 0), 'Closed · opens Mon 11am');
});

test('closing within the hour is said so', () => {
  const s = openState(shop, JST, tokyo('2026-12-14', 19, 30));
  assert.equal(describeOpen(s, 1), 'Closes soon · 8pm');
});

test('a bar is open past midnight and closes at five', () => {
  const s = openState(bar, JST, tokyo('2026-12-15', 2)); // Tuesday 02:00, from Monday night
  assert.equal(s.open, true);
  assert.deepEqual([s.next.day, s.next.minute], [2, 5 * 60]);
  assert.equal(describeOpen(s, 2), 'Open · closes 5am');
});

test('the Saturday-night period wraps over the end of the week', () => {
  const s = openState(bar, JST, tokyo('2026-12-13', 3)); // Sunday 03:00, from Saturday night
  assert.equal(s.open, true);
  assert.equal(openAt(bar, 6 * 1440 + 23 * 60), true);
  assert.equal(openAt(bar, 12 * 60), false);
});

test('open 24 hours', () => {
  const s = openState(always, JST, tokyo('2026-12-14', 4));
  assert.deepEqual(s, { open: true, always: true, next: null });
  assert.equal(describeOpen(s, 1), 'Open 24 hours');
  assert.equal(dayHours(always, 3), 'Open 24 hours');
});

test('periods that meet at midnight are one stretch', () => {
  const s = openState(late, JST, tokyo('2026-12-14', 23)); // Monday 23:00
  assert.equal(s.open, true);
  assert.deepEqual([s.next.day, s.next.minute], [2, 120]);
});

test('the week table, overnight hours and closed days', () => {
  assert.equal(dayHours(shop, 1), '11am–8pm');
  assert.equal(dayHours(shop, 0), 'Closed');
  assert.equal(dayHours(bar, 5), '6pm–5am');
  assert.equal(dayHours({}, 1), '');
});

test('open at a planned time on a trip day', () => {
  assert.equal(openOn(shop, '2026-12-14', '12:30'), true);
  assert.equal(openOn(shop, '2026-12-13', '12:30'), false); // Sunday
  assert.equal(openOn(bar, '2026-12-14', '23:00'), true);
  assert.equal(openOn(shop, '2026-12-14', ''), null);
  assert.equal(openOn({}, '2026-12-14', '12:00'), null);
});

test('no hours, nothing to say', () => {
  assert.equal(openState({}, JST), null);
  assert.equal(describeOpen(null, 1), '');
});
