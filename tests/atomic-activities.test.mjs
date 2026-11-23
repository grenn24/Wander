import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pinQueries, applyPins } from '../lib/geo.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/*
 * "add ralph lauren and moma design store ginza loft to my ginza shopping"
 * became one entry, "Shopping at Ralph Lauren and MoMA Design Store Ginza
 * Loft", located at "Ginza, Chuo City". Two shops, one district-sized pin.
 */
const drafts = [
  { title: 'Ralph Lauren Ginza', location: 'Ralph Lauren Ginza, Ginza, Chuo City, Tokyo', category: 'shopping', day: '2026-12-12' },
  { title: 'MoMA Design Store', location: 'MoMA Design Store, Ginza Loft, Ginza, Tokyo', category: 'shopping', day: '2026-12-12' },
];

test('each place is looked up with its own name, kind and day', () => {
  assert.deepEqual(pinQueries(drafts), [
    { id: '0', query: drafts[0].location, title: 'Ralph Lauren Ginza', category: 'shopping', day: '2026-12-12' },
    { id: '1', query: drafts[1].location, title: 'MoMA Design Store', category: 'shopping', day: '2026-12-12' },
  ]);
});

test('entries with no place words, or already pinned, are not looked up', () => {
  const items = pinQueries([
    { title: 'Rest', location: '' },
    { title: 'Pinned', location: 'Ginza Six', lat: 35.67, lng: 139.76 },
    { title: 'Itoya', location: 'Itoya, Ginza, Tokyo' },
    null,
  ]);
  assert.deepEqual(items.map((i) => i.id), ['2']);
});

test("Google's street address replaces the model's words, with the pin and photo", () => {
  const out = applyPins(drafts, [
    { id: '0', found: true, confidence: 'high', lat: 35.6716, lng: 139.7650,
      label: '4 Chome-4-5 Ginza, Chuo City, Tokyo 104-0061, Japan', place_id: 'p0', photo_ref: 'ph0' },
    { id: '1', found: true, confidence: 'medium', lat: 35.6748, lng: 139.7635,
      label: '2 Chome-2-14 Ginza, Chuo City, Tokyo 104-0061, Japan', place_id: 'p1', photo_ref: '' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Ralph Lauren Ginza');
  assert.equal(out[0].location, '4 Chome-4-5 Ginza, Chuo City, Tokyo 104-0061, Japan');
  assert.deepEqual([out[0].lat, out[0].lng, out[0].place_id, out[0].photo_ref], [35.6716, 139.7650, 'p0', 'ph0']);
  assert.equal(out[1].location, '2 Chome-2-14 Ginza, Chuo City, Tokyo 104-0061, Japan');
  assert.equal(out[1].photo_ref, null);
  // The input is not changed under the caller.
  assert.equal(drafts[0].lat, undefined);
});

test('a rejected, missing or malformed match keeps the words and no pin', () => {
  const out = applyPins(drafts, [
    { id: '0', found: true, confidence: 'low', lat: 1, lng: 1, label: 'Somewhere else' },
    { id: '1', found: false, candidates: [] },
    { id: '7', found: true, confidence: 'high', lat: 1, lng: 1, label: 'Nobody asked' },
  ]);
  assert.deepEqual(out, drafts);
  const noPoint = applyPins(drafts, [{ id: '0', found: true, confidence: 'high', label: 'No coordinates' }]);
  assert.deepEqual(noPoint, drafts);
});

test('the quick-add line can answer with one entry per place', () => {
  const route = read('app/api/parse/route.js');
  assert.match(route, /required: \['understood', 'question', 'activities'\]/);
  assert.match(route, /activities: \{\s*type: 'array'/);
  assert.match(route, /One place, one entry/);
  // Old tabs read a single entry until they reload.
  assert.match(route, /activity: activities\[0\]/);
  // The model can see each stop's stretch and place, to fit inside "my Ginza shopping".
  assert.match(route, /end_time/);
  assert.match(route, / @ \$\{where\}/);

  const quick = read('components/QuickAdd.jsx');
  assert.match(quick, /pinPlaces\(drafts, trip\.destination/);
  assert.match(quick, /end_time: a\.end_time, location: a\.location/);
  assert.doesNotMatch(quick, /onCreate\(\{/, 'every create is a list');
  assert.match(read('components/Itinerary.jsx'), /onCreate=\{\(drafts\) => onAddMany\(drafts\)\}/);
});

test('every planner keeps one place per activity, located to the venue', () => {
  for (const path of ['app/api/plan/route.js', 'app/api/command/route.js', 'app/api/suggest/route.js']) {
    const src = read(path);
    assert.match(src, /Google Maps to land/, `${path} asks for a venue-level search`);
    assert.match(src, /[Nn]ever only a\s+district/, `${path} rules out a district for a venue`);
  }
  assert.match(read('app/api/plan/route.js'), /One place, one activity/);
  assert.match(read('app/api/command/route.js'), /One place, one activity/);
  assert.match(read('components/AiSuggest.jsx'), /pinPlaces\(/);
});
