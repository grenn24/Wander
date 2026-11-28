import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanTime } from '../lib/ai.js';
import { activityLine, activityListing, timesLabel } from '../lib/commandListing.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// As Supabase returns it: Postgres time columns carry seconds.
const ramen = {
  id: 'c95d38cc', day: '2026-10-02', start_time: '12:00:00', end_time: '13:15:00',
  title: 'Ramen at Ichiran Shibuya', category: 'food', location: 'Ichiran Shibuya, Shibuya',
};

test('a stop is shown to the model with its start and its end, as a clock range', () => {
  assert.equal(timesLabel(ramen), '12:00–13:15');
  const line = activityLine(ramen);
  assert.match(line, /\| 12:00–13:15 \|/);
  // "12:00:00" read as a time is the only clock in sight, and "30 minutes
  // longer" then came back as an end of 12:30.
  assert.doesNotMatch(line, /\d:\d{2}:\d{2}/);
});

test('missing times are said in words, not left for the model to guess', () => {
  assert.equal(timesLabel({ start_time: '15:00:00', end_time: null }), '15:00, no end time');
  assert.equal(timesLabel({ start_time: null, end_time: '11:00' }), 'ends 11:00, no start time');
  assert.equal(timesLabel({}), 'no time set');
  assert.equal(timesLabel({ start_time: 'noon', end_time: '' }), 'no time set');
});

test('every activity in the listing carries its end time', () => {
  const sky = { ...ramen, id: 'sky', start_time: '14:30', end_time: '18:45', title: 'Shibuya Sky' };
  const listing = activityListing([ramen, sky]).split('\n');
  assert.equal(listing.length, 2);
  assert.match(listing[0], /^id=c95d38cc \| 2026-10-02 \| 12:00–13:15 \| Ramen/);
  assert.match(listing[1], /^id=sky \| 2026-10-02 \| 14:30–18:45 \| Shibuya Sky/);
  assert.equal(activityListing(undefined), '');
});

test('the sanitiser keeps a time the model answers with seconds', () => {
  assert.equal(cleanTime('13:45'), '13:45');
  assert.equal(cleanTime('9:05'), '09:05');
  assert.equal(cleanTime('13:45:00'), '13:45');
  assert.equal(cleanTime(' 13:45 '), '13:45');
  for (const bad of ['24:00', '12:60', '12:30:60', '12:30 pm', '30', '1345', '', null, undefined]) {
    assert.equal(cleanTime(bad), null, String(bad));
  }
});

test('the command bar sends end times, and the route lists them and says how to change one stop', () => {
  assert.match(read('components/Command.jsx'), /end_time: a\.end_time,/);
  // The editor the command bar and the Assistant share.
  const route = read('lib/tripEdits.js');
  assert.match(route, /const listing = activityListing\(activities\)/);
  assert.match(route, /start_time and end_time are clock times, never durations/);
  assert.match(route, /set only its end_time, to the listed end plus or minus N/);
  assert.match(route, /set both start_time and end_time so it keeps its length/);
});

test('a journey is listed with its kind, so a flight is known as one', () => {
  const flight = { id: 'f', day: '2026-12-05', start_time: '07:00', end_time: '08:35', title: 'Flight to Sapporo', category: 'transport', subtype: 'flight' };
  assert.match(activityLine(flight), /\| transport\/flight( \||$)/);
  assert.match(activityLine({ ...flight, subtype: null }), /\| transport$/);
});
