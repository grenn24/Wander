import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtTime, fmtMinute } from '../lib/util.js';

test('times are 12-hour', () => {
  assert.equal(fmtTime('10:06'), '10:06am');
  assert.equal(fmtTime('00:00'), '12am');
  assert.equal(fmtTime('12:30'), '12:30pm');
});

test('a timetable minute, past midnight included, is a 12-hour time', () => {
  assert.equal(fmtMinute(0), '12am');
  assert.equal(fmtMinute(606), '10:06am');
  assert.equal(fmtMinute(720), '12pm');
  assert.equal(fmtMinute(1453), '12:13am');
  assert.equal(fmtMinute(1500), '1am');
  assert.equal(fmtMinute(-5), '11:55pm');
});
