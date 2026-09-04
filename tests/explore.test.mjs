import test from 'node:test';
import assert from 'node:assert/strict';
import { NEARBY_KINDS, exploreAreas, containsPoint, spreadResults, viewportChanged } from '../lib/explore.js';
import { nearbyPlaces } from '../lib/places.js';

const city = { north: 22.75, south: 22.45, west: 113.9, east: 114.3 };
const local = { north: 22.605, south: 22.595, west: 114.095, east: 114.105 };

test('neighbourhood uses one request; city uses four popularity-ranked quadrants', () => {
  const close = exploreAreas(22.6, 114.1, 900, local);
  assert.equal(close.length, 1);
  assert.equal(close[0].rank, 'DISTANCE');
  const areas = exploreAreas(22.6, 114.1, 900, city);
  assert.equal(areas.length, 4);
  assert.equal(new Set(areas.map((a) => JSON.stringify(a.center))).size, 4);
  for (const a of areas) {
    assert.equal(a.rank, 'POPULARITY');
    assert.ok(a.radius > 4000 && a.radius <= 50000);
    assert.ok(containsPoint(city, a.center));
  }
});

test('bad or continent-sized bounds are rejected rather than silently truncated', () => {
  for (const b of [{}, { ...city, north: null }, { ...city, south: 24 }, { ...city, east: 181 },
    { north: 40, south: 20, west: 100, east: 120 }]) {
    assert.throws(() => exploreAreas(22.6, 114.1, 900, b), { status: 400 });
  }
  assert.throws(() => exploreAreas(91, 0), { status: 400 });
  assert.equal(exploreAreas(0, 0, 900)[0].radius, 900);
});

test('a viewport crossing the date line keeps real locations on either side', () => {
  const b = { north: 0.1, south: -0.1, west: 179.8, east: -179.8 };
  const areas = exploreAreas(0, 180, 900, b);
  assert.equal(areas.length, 4);
  assert.ok(containsPoint(b, { lat: 0, lng: 179.9 }));
  assert.ok(containsPoint(b, { lat: 0, lng: -179.9 }));
  assert.equal(containsPoint(b, { lat: 0, lng: 0 }), false);
  assert.ok(areas.every((a) => a.radius < 50000));
});

test('merge shares slots across districts, removes duplicates and handles empty areas', () => {
  const groups = Array.from({ length: 4 }, (_, cell) => Array.from({ length: 20 }, (_, i) => ({ id: `${cell}-${i}` })));
  const results = spreadResults(groups);
  assert.equal(results.length, 24);
  for (let cell = 0; cell < 4; cell += 1) assert.equal(results.filter((p) => p.id.startsWith(`${cell}-`)).length, 6);
  assert.deepEqual(spreadResults([[{ id: 'a' }, { id: 'b' }], [], [{ id: 'a' }, { id: 'c' }]]).map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(spreadResults([[], []]), []);
});

test('zoom without panning offers a fresh search; small idle changes do not', () => {
  const before = { lat: 22.6, lng: 114.1, spanKm: 20 };
  assert.equal(viewportChanged(before, { ...before, spanKm: 40 }), true);
  assert.equal(viewportChanged(before, { ...before, spanKm: 10 }), true);
  assert.equal(viewportChanged(before, { ...before, lng: 114.4 }), true);
  assert.equal(viewportChanged(before, { ...before, lng: 114.101, spanKm: 20.01 }), false);
});

test('new explore categories map to the correct itinerary types', () => {
  assert.equal(NEARBY_KINDS.find((k) => k.id === 'hotels').category, 'lodging');
  for (const id of ['cafes', 'activities', 'parks', 'spas']) assert.ok(NEARBY_KINDS.find((k) => k.id === id)?.types.length);
});

test('server sends viewport searches and returns in-view results from every district', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    const cell = calls.push(body) - 1;
    const center = body.locationRestriction.circle.center;
    return Response.json({ places: [
      { id: `hotel-${cell}`, displayName: { text: `Hotel ${cell}` }, formattedAddress: `Address ${cell}`, location: center },
      { id: 'outside', location: { latitude: 0, longitude: 0 } },
    ] });
  });
  const results = await nearbyPlaces(22.6, 114.1, 'hotels', 900, city);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.rankPreference === 'POPULARITY' && c.includedTypes.includes('hotel')));
  assert.equal(results.length, 4);
  assert.ok(results.every((p) => p.category === 'lodging' && p.place_id && p.location.startsWith('Address') && containsPoint(city, p)));
});

test('server preserves close-up behaviour, validates categories and propagates provider failures', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return Response.json({ places: [] }); });
  assert.deepEqual(await nearbyPlaces(22.6, 114.1, 'food', 900, local), []);
  assert.equal(calls, 1);
  await assert.rejects(nearbyPlaces(22.6, 114.1, 'unknown', 900, city), { status: 400 });
  assert.equal(calls, 1);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Unavailable' } }, { status: 503 }));
  await assert.rejects(nearbyPlaces(22.6, 114.1, 'food', 900, city));
});
