import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionsOf, routeOf, boundsOf, fitZoom, pointAlong, spanKm } from '../lib/journeyMap.js';

const blocks = [
  { type: 'heading', text: 'St. George to Escalante', kicker: 'Days 1–3' },
  { type: 'prose', text: 'Start at {p1}, then {p2}.' },
  { type: 'tip', text: 'Check {p2} before driving.' },
  { type: 'heading', text: 'Escalante', kicker: 'Days 4–6' },
  { type: 'day', items: [{ time: '7:30', text: 'Walk {p3}.' }, { time: '16:30', text: 'Back past {p1}.' }] },
  { type: 'prose', text: 'Old style', kicker: 'Days 7–8 · Needles' },
  { type: 'prose', text: 'Nothing mapped: {p9}.' },
];
const places = [
  { id: 'p1', name: 'Snow Canyon', lat: 37.2, lng: -113.6 },
  { id: 'p2', name: 'Cedar Breaks', lat: 37.6, lng: -112.8 },
  { id: 'p3', name: 'Calf Creek', lat: 37.8, lng: -111.4 },
  { id: 'p9', name: 'No position' },
];

test('a journal divides into sections, each with the places it names in order', () => {
  const secs = sectionsOf(blocks);
  assert.deepEqual(secs.map((x) => x.start), [0, 3, 5]);
  assert.deepEqual(secs[0], { start: 0, kicker: 'Days 1–3', title: 'St. George to Escalante', places: ['p1', 'p2'] });
  assert.deepEqual(secs[1].places, ['p3', 'p1']);
  assert.deepEqual([secs[2].kicker, secs[2].title, secs[2].places], ['Days 7–8', 'Needles', ['p9']]);
  assert.deepEqual(sectionsOf([{ type: 'prose', text: '{p1}' }]).map((x) => x.places), [['p1']]);
  assert.deepEqual(sectionsOf(undefined), []);
});

test('the route follows the order the journal first names each mapped place', () => {
  const route = routeOf({ blocks, places });
  assert.deepEqual(route.map((st) => [st.id, st.section]), [['p1', 0], ['p2', 0], ['p3', 1]]);
});

test('the camera zooms to fit a set of stops, and a single stop gets the cap', () => {
  const b = boundsOf(places.slice(0, 3));
  assert.deepEqual(b, { north: 37.8, south: 37.2, east: -111.4, west: -113.6 });
  const z = fitZoom(b, 400, 700, { pad: 56 });
  assert.ok(z > 6 && z < 9, `zoom ${z}`);
  assert.ok(fitZoom(b, 1600, 1400, { pad: 56 }) > z);
  assert.equal(fitZoom(boundsOf([places[0]]), 400, 700, { max: 10 }), 10);
});

test('a point part of the way along a leg, and roughly how long the leg is', () => {
  assert.deepEqual(pointAlong({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 0.25), { lat: 2.5, lng: 5 });
  assert.deepEqual(pointAlong({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 3), { lat: 10, lng: 20 });
  const km = spanKm(places[0], places[2]);
  assert.ok(km > 190 && km < 220, `${km} km`);
});
