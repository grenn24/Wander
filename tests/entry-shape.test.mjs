import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DETAIL_KEYS, detailsSchema, detailKeysFor, cleanDetails, activityRow,
} from '../lib/entryShape.js';
import { cleanEdits } from '../lib/tripEdits.js';
import { placeChoice } from '../lib/placeChoice.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------ one set of fields --- */

test('an entry keeps only the fields its kind has', () => {
  const sent = { gate: 'B7', seat: '2A', pier: '4', from: 'SIN', to: 'HND', check_in_date: '2026-12-03' };
  assert.deepEqual(cleanDetails('transport', 'flight', sent), { gate: 'B7', seat: '2A', from: 'SIN', to: 'HND' });
  assert.deepEqual(cleanDetails('transport', 'bus', sent), { seat: '2A', from: 'SIN', to: 'HND' }, 'a bus has no gate');
  assert.deepEqual(cleanDetails('transport', 'ferry', sent), { seat: '2A', pier: '4', from: 'SIN', to: 'HND' });
  assert.deepEqual(cleanDetails('transport', null, sent), { from: 'SIN', to: 'HND' }, 'a journey of no known kind keeps its two ends');
  assert.deepEqual(cleanDetails('food', null, sent), {}, 'a dinner keeps nothing');
  assert.deepEqual(cleanDetails('transport', 'flight', { code: '  SQ638  ', gate: '', seat: null }), { code: 'SQ638' });
  assert.deepEqual(cleanDetails('transport', 'flight', sent, { only: ['from', 'to', 'code'] }), { from: 'SIN', to: 'HND' });
  assert.deepEqual(cleanDetails('transport', 'flight', null), {});
});

test('a stay\'s dates are checked as dates, and an edit may clear one', () => {
  assert.deepEqual(cleanDetails('lodging', null, { check_in_date: '2026-12-03', check_out_date: '2026-02-30', gate: 'A' }),
    { check_in_date: '2026-12-03', check_out_date: '', check_in_time: '', check_out_time: '' });
  assert.deepEqual(cleanDetails('lodging', null, { check_out_date: '', gate: 'A' }, { clearing: true }),
    { check_out_date: '' }, 'an empty string clears the field');
  assert.deepEqual(detailKeysFor('lodging'), ['check_in_date', 'check_out_date', 'check_in_time', 'check_out_time']);
});

test('the editor holds edits to the same rules: no gate on a bus, nothing on a dinner', () => {
  const activities = [
    { id: 'bus', category: 'transport', subtype: 'bus', title: 'Bus to Osaka' },
    { id: 'dinner', category: 'food', title: 'Dinner' },
    { id: 'hotel', category: 'lodging', title: 'Hotel' },
  ];
  const op = (o) => ({ kind: 'update_activity', describe: 'x', ...o });
  const out = cleanEdits({
    understood: true,
    summary: 's',
    ops: [
      op({ activity_id: 'bus', details: { gate: 'B7', seat: '2A' } }),
      op({ activity_id: 'dinner', details: { gate: 'B7' } }),
      op({ activity_id: 'hotel', details: { check_out_date: '' } }),
      // Turning it into a flight in the same edit: the flight's fields apply.
      op({ activity_id: 'bus', subtype: 'flight', details: { gate: 'B7' } }),
      { kind: 'add_activity', describe: 'x', category: 'transport', subtype: 'flight', details: { gate: 'C3', pier: '2' } },
    ],
  }, activities);
  assert.deepEqual(out.ops.map((o) => o.details), [
    { seat: '2A' }, null, { check_out_date: '' }, { gate: 'B7' }, { gate: 'C3' },
  ]);
});

test('every writer offers the model the same fields, from one place', () => {
  const schema = detailsSchema();
  assert.deepEqual(schema.required, DETAIL_KEYS);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(detailsSchema({ nullable: true }).type, ['object', 'null']);
  const quick = detailsSchema({ keys: ['code'], describe: { code: 'The number' } });
  assert.deepEqual(quick.properties, { code: { type: ['string', 'null'], description: 'The number' } });
  for (const path of ['app/api/plan/route.js', 'lib/tripEdits.js', 'app/api/parse/route.js']) {
    const src = read(path);
    assert.match(src, /from '(@\/lib|\.)\/entryShape(\.js)?'/, `${path} uses the shared shape`);
    assert.doesNotMatch(src, /const DETAIL_KEYS =|function cleanDetails\(/, `${path} keeps no copy of its own`);
  }
});

/* ------------------------------------------------- one row shape --- */

test('an entry becomes the same row however it was made', () => {
  assert.deepEqual(activityRow({
    day: '2026-12-03', title: '  Dinner  ', category: 'food', subtype: 'flight', details: { gate: 'B7' },
    lat: '35.6', lng: '', cost: 'lots', place_id: 'p1',
  }), {
    day: '2026-12-03', title: 'Dinner', start_time: null, end_time: null, category: 'food', location: '',
    lat: 35.6, lng: null, cost: 0, subtype: null, details: {}, booking_ref: '', notes: '',
    place_id: 'p1', photo_ref: null,
  }, 'a dinner sheds a leftover kind and its fields');
  assert.equal(activityRow({}).title, 'Untitled');
  assert.equal(activityRow({}).category, 'sightseeing');
  const flight = activityRow({ day: '2026-12-03', category: 'transport', subtype: 'flight', details: { code: 'JL36', _arrive: { q: 'HND' } } });
  assert.deepEqual(flight.details, { code: 'JL36', _arrive: { q: 'HND' } }, 'the app\'s own keys are kept');
  const stay = activityRow({ day: '2026-12-01', category: 'lodging', details: { check_in_date: '2026-12-03', check_in_time: '15:00' } });
  assert.equal(stay.day, '2026-12-03', 'a stay sits on its check-in day');
  assert.equal(stay.start_time, '15:00');
});

test('the trip page and the planner save rows through it', () => {
  const provider = read('components/TripProvider.jsx');
  assert.match(provider, /return \{ trip_id: tripId, \.\.\.activityRow\(draft\)/);
  assert.match(provider, /const row = activityRow\(d\);/);
  assert.doesNotMatch(provider, /details: d\.category === 'transport'/, 'no second copy of the rules');
  const page = read('app/plan/page.js');
  assert.match(page, /trip_id: trip\.id, \.\.\.activityRow\(row\), sort_order: row\.sort_order/);
});

/* ---------------------------------------------- one pause to choose --- */

const items = [{ id: 'a', candidates: [] }, { id: 'b', candidates: [] }];

test('a choice is awaited, answered and carried on with', async () => {
  const choice = placeChoice();
  const seen = [];
  choice.subscribe(() => seen.push(choice.get()));
  const answer = choice.ask(items);
  assert.deepEqual(choice.get(), { items, selected: {} });
  choice.choose('a', 'place-1');
  assert.equal(choice.ready(), false, 'every item needs an answer');
  choice.choose('b', '__none__');
  assert.equal(choice.ready(), true);
  choice.done();
  assert.deepEqual(await answer, { a: 'place-1', b: '__none__' });
  assert.equal(choice.get(), null, 'the picker closes');
  assert.ok(seen.length >= 4, 'the page hears every change');
});

test('going back, or a newer question, answers null', async () => {
  const choice = placeChoice();
  const first = choice.ask(items);
  const second = choice.ask(items.slice(0, 1));
  assert.equal(await first, null);
  choice.cancel();
  assert.equal(await second, null);
  choice.done(); // nothing open: nothing happens
  choice.choose('a', 'x');
  assert.equal(choice.get(), null);
});

test('the planner and the apply step wait on the same pause', () => {
  const page = read('app/plan/page.js');
  assert.match(page, /const selected = await askPlace\(uncertain\)/);
  assert.doesNotMatch(page, /placeReviewResolveRef/);
  const apply = read('components/useApplyChanges.js');
  assert.match(apply, /const selected = await choice\.ask\(places\.uncertain\)/);
  assert.match(apply, /activities: now\.current\.activities/, 'saved against the trip as it is after the choice');
  for (const path of ['app/plan/page.js', 'components/useApplyChanges.js']) {
    assert.match(read(path), /import usePlaceChoice from '@\/components\/usePlaceChoice'/);
  }
});
