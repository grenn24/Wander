import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activityGap, fmtDuration } from '../lib/util.js';
const flight = { day: '2026-11-26', start_time: '09:30:00', end_time: '12:35:00' };
const hotel = { day: flight.day, start_time: '14:00:00' };
test('reported flight-to-hotel gap is visible even below 90 minutes', () => {
  assert.equal(activityGap(flight, hotel), 85);
  assert.equal(fmtDuration(activityGap(flight, hotel)), '1h 25m');
});
test('short known gaps are not silently hidden', () => {
  assert.equal(activityGap(flight, { ...hotel, start_time: '12:45' }), 10);
});
test('consecutive or overlapping events have no interval separator', () => {
  assert.equal(activityGap(flight, { ...hotel, start_time: '12:35' }), null);
  assert.equal(activityGap(flight, { ...hotel, start_time: '12:00' }), null);
});
test('unknown durations, cross-day and overnight events never invent a gap', () => {
  assert.equal(activityGap({ ...flight, end_time: null }, hotel), null);
  assert.equal(activityGap(flight, { ...hotel, start_time: null }), null);
  assert.equal(activityGap(flight, { ...hotel, day: '2026-11-27' }), null);
  assert.equal(activityGap({ ...flight, start_time: '23:00', end_time: '01:00' }, hotel), null);
  assert.equal(activityGap({ ...flight, end_time: '25:00' }, hotel), null);
  assert.equal(activityGap(null, hotel), null);
});
test('itinerary labels intervals neutrally and never gates them at 90 minutes', () => {
  const source = readFileSync(new URL('../components/Itinerary.jsx', import.meta.url), 'utf8');
  assert.match(source, /between activities/);
  assert.doesNotMatch(source, /gapMins >= 90|fmtDuration\(gapMins\)\} free/);
});
