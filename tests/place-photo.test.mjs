import test from 'node:test';
import assert from 'node:assert/strict';
import { placeOfPhoto } from '../lib/places.js';

test('a stale photo reference still names its place, to ask for its photos again', () => {
  assert.equal(placeOfPhoto('places/ChIJ45IxpAtkGGAR3_hG0anDMg0/photos/AVoNoX-1_ab'), 'ChIJ45IxpAtkGGAR3_hG0anDMg0');
  // Only ever a Google photo resource name.
  assert.equal(placeOfPhoto('https://example.com/a.jpg'), null);
  assert.equal(placeOfPhoto('places/ChIJ/photos/a/../../secret'), null);
  assert.equal(placeOfPhoto(''), null);
  assert.equal(placeOfPhoto(undefined), null);
});

test('a trip that names the same place on several days searches for it once', async () => {
  const { resolveMany } = await import('../lib/places.js');
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    const { textQuery } = JSON.parse(init.body);
    asked.push(textQuery);
    return new Response(JSON.stringify({
      places: [{
        id: `id-${textQuery}`,
        displayName: { text: textQuery.split(',')[0] },
        formattedAddress: `${textQuery.split(',')[0]}, Kyoto, Japan`,
        location: { latitude: 35, longitude: 135.7 },
        primaryType: 'lodging',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const results = await resolveMany([
      { id: '1', query: 'Hotel Kanra', title: 'Check in', category: 'lodging' },
      { id: '2', query: 'Nishiki Market', title: 'Lunch', category: 'food' },
      { id: '3', query: 'hotel  kanra', title: 'Back to the hotel', category: 'lodging' },
      { id: '4', query: 'Hotel Kanra', title: 'Check out', category: 'lodging' },
    ], 'Kyoto');
    assert.deepEqual(asked.sort(), ['Hotel Kanra, Kyoto', 'Nishiki Market, Kyoto']);
    // Every stop still gets its own answer, in order, scored for itself.
    assert.deepEqual(results.map((r) => [r.id, r.found, r.place_id]), [
      ['1', true, 'id-Hotel Kanra, Kyoto'],
      ['2', true, 'id-Nishiki Market, Kyoto'],
      ['3', true, 'id-Hotel Kanra, Kyoto'],
      ['4', true, 'id-Hotel Kanra, Kyoto'],
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
