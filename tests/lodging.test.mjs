import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanLodging, hasStayDates, itineraryEntries, lodgingError, lodgingPayload, moveStay, stayOnDay, validStayDate } from '../lib/lodging.js';

const hotel = { id: 'hotel', title: 'CYBO Station', category: 'lodging', day: '2026-11-26',
  cost: 600, details: { check_in_date: '2026-11-26', check_out_date: '2026-12-04',
    check_in_time: '15:00', check_out_time: '11:00' } };

test('one booking projects two distinct entries sharing the original record; cost counted once', () => {
  const entries = itineraryEntries([hotel]);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((a) => a.day), ['2026-11-26', '2026-12-04']);
  assert.deepEqual(entries.map((a) => a.start_time), ['15:00', '11:00']);
  assert.equal(new Set(entries.map((a) => a._entryId)).size, 2);
  assert.ok(entries.every((a) => a._source === hotel && a.id === hotel.id));
  assert.equal(entries.reduce((s, a) => s + a.cost, 0), 600);
  assert.equal(hotel.day, '2026-11-26');
});

test('only intervening days get icons, excluding both endpoints', () => {
  assert.equal(stayOnDay(hotel, '2026-11-25'), false);
  assert.equal(stayOnDay(hotel, '2026-11-26'), false);
  assert.equal(stayOnDay(hotel, '2026-11-27'), true);
  assert.equal(stayOnDay(hotel, '2026-12-03'), true);
  assert.equal(stayOnDay(hotel, '2026-12-04'), false);
});

test('one endpoint creates one entry and never guesses covered nights', () => {
  for (const phase of ['check_in', 'check_out']) {
    const a = { ...hotel, details: { [`${phase}_date`]: '2026-11-28' } };
    const [entry] = itineraryEntries([a]);
    assert.equal(entry._phase, phase);
    assert.equal(entry.start_time, null);
    assert.equal(entry.cost, hotel.cost);
    assert.equal(stayOnDay(a, '2026-11-29'), false);
    assert.equal(itineraryEntries([a]).length, 1);
  }
});

test('same-day check-in/out yields two entries, no night icon and one cost', () => {
  const a = { ...hotel, details: { ...hotel.details, check_out_date: hotel.day, check_out_time: '18:00' } };
  assert.equal(lodgingError(a.details), '');
  assert.equal(itineraryEntries([a]).length, 2);
  assert.equal(stayOnDay(a, hotel.day), false);
});

test('invalid ranges cannot imply hotel coverage', () => {
  const a = { ...hotel, details: { ...hotel.details, check_out_date: '2026-11-25' } };
  assert.ok(lodgingError(a.details));
  assert.equal(stayOnDay(a, '2026-11-27'), false);
  assert.ok(lodgingError({ ...hotel.details, check_out_date: hotel.day }));
});

test('cleared structured dates are unscheduled; old note-only activities remain unchanged', () => {
  const a = { ...hotel, details: cleanLodging({ check_in_date: '' }) };
  assert.equal(hasStayDates(a), true);
  assert.deepEqual(itineraryEntries([a]), []);
  const legacy = { ...hotel, details: {}, notes: 'Check-in Nov 26, checkout Dec 4' };
  assert.equal(hasStayDates(legacy), false);
  assert.equal(itineraryEntries([legacy])[0], legacy);
  assert.deepEqual(lodgingPayload(legacy), {});
});

test('date sanitization validates actual dates and whitelists booking fields', () => {
  assert.equal(validStayDate('2026-02-30'), false);
  assert.equal(validStayDate('2028-02-29'), true);
  assert.equal(validStayDate('2026-11-26T00:00:00'), false);
  assert.deepEqual(cleanLodging({ check_in_date: '2026-02-30', check_in_time: '25:00', gate: 'A' }),
    { check_in_date: '', check_out_date: '', check_in_time: '', check_out_time: '' });
});

test('saving retains out-of-trip dates and normalizes the anchor without duplicate rows', () => {
  const payload = lodgingPayload({ ...hotel, day: '2026-11-28', end_time: '17:00' });
  assert.equal(payload.day, hotel.day);
  assert.equal(payload.start_time, '15:00');
  assert.equal(payload.end_time, null);
  assert.equal(payload.details.check_out_date, '2026-12-04');
});

test('moving a booking shifts both dates across months without changing duration', () => {
  const patch = moveStay(hotel, '2026-12-01');
  assert.equal(patch.details.check_in_date, '2026-12-01');
  assert.equal(patch.details.check_out_date, '2026-12-09');
  assert.equal(patch.details.check_in_time, '15:00');
  assert.equal(hotel.details.check_out_date, '2026-12-04');
});

test('overlapping hotels remain separate editable bookings', () => {
  const second = { ...hotel, id: 'second' };
  assert.equal([hotel, second].filter((a) => stayOnDay(a, '2026-11-28')).length, 2);
  assert.equal(itineraryEntries([hotel, second]).length, 4);
});

test('UI and AI paths retain shared booking metadata and accessible nonmoving hover feedback', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.match(read('components/Itinerary.jsx'), /onEdit\(a\._source \|\| a\)/);
  assert.match(read('components/Itinerary.jsx'), /aria-label=\{`Hotel for tonight:/);
  assert.match(read('components/ActivityModal.jsx'), /confirm === 'outside'/);
  assert.match(read('components/Command.jsx'), /details: a.details/);
  assert.match(read('app/api/plan/route.js'), /return cleanLodging\(a.details\)/);
  assert.match(read('app/api/command/route.js'), /...LODGING_KEYS/);
  assert.match(read('app/globals.css'), /prefers-reduced-motion: reduce/);
  assert.match(read('app/globals.css'), /\.act \{ transition: background-color 220ms/);
  assert.match(read('components/Itinerary.jsx'), /data-tip=\{hotelName\} data-tip-detail=\{dates\}/);
  assert.doesNotMatch(read('components/Itinerary.jsx'), /data-tip=\{detail\}/);
  assert.match(read('app/globals.css'), /\.act\.is-anchor \.photo \{ box-shadow: none; border: 0; \}/);
  assert.match(read('app/globals.css'), /\.tip-stay-name[^}]*-webkit-line-clamp: 2/);
});
