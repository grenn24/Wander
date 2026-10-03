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

test('the time where the trains run, whatever the phone says', async () => {
  const { zonedNow, clockMinutes } = await import('../lib/util.js');
  assert.deepEqual(zonedNow('Asia/Tokyo', new Date('2026-11-10T01:05:00Z')), { date: '2026-11-10', minute: 10 * 60 + 5 });
  assert.deepEqual(zonedNow('Asia/Tokyo', new Date('2026-11-10T15:30:00Z')), { date: '2026-11-11', minute: 30 });
  assert.deepEqual(zonedNow('Europe/Paris', new Date('2026-11-10T15:30:00Z')), { date: '2026-11-10', minute: 16 * 60 + 30 });
  assert.deepEqual(zonedNow(undefined, new Date('2026-11-10T01:05:00Z')), { date: '2026-11-10', minute: 605 }, 'Japan by default');
  assert.deepEqual(zonedNow('Not/AZone', new Date('2026-11-10T01:05:00Z')), { date: '2026-11-10', minute: 605 }, 'and for a zone it cannot read');
  assert.equal(clockMinutes('09:30:00'), 570);
  assert.equal(clockMinutes('18:05'), 1085);
  assert.equal(clockMinutes(''), null);
});
