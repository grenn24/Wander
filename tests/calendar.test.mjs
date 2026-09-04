import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, clampDate, dateLabel, offsetDate, offsetMonth } from '../lib/calendar.js';

test('calendar has six complete Sunday-first weeks across month boundaries', () => {
  const days = calendarDays('2026-09-04');
  assert.equal(days.length, 42);
  assert.equal(days[0], '2026-08-30');
  assert.equal(days[41], '2026-10-10');
  assert.equal(new Set(days).size, 42);
});
test('month and year navigation clamps end-of-month and leap days', () => {
  assert.equal(offsetMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(offsetMonth('2028-01-31', 1), '2028-02-29');
  assert.equal(offsetMonth('2028-02-29', 12), '2029-02-28');
  assert.equal(offsetMonth('2026-12-15', 1), '2027-01-15');
  assert.equal(offsetMonth('2026-01-15', -1), '2025-12-15');
});
test('day navigation crosses DST and years without local-time drift', () => {
  assert.equal(offsetDate('2026-03-08', 1), '2026-03-09');
  assert.equal(offsetDate('2026-12-31', 1), '2027-01-01');
  assert.equal(offsetDate('2028-03-01', -1), '2028-02-29');
});
test('minimum/maximum dates constrain navigation and labels are unambiguous', () => {
  assert.equal(clampDate('2026-09-01', '2026-09-04'), '2026-09-04');
  assert.equal(clampDate('2026-10-01', undefined, '2026-09-30'), '2026-09-30');
  assert.equal(dateLabel('2026-09-04'), '4 Sept 2026');
});
