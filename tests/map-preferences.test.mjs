import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMapPreferences, mapColorScheme, MAP_TYPES, MAP_TYPE_OPTIONS, MAP_ROUTES,
} from '../lib/mapPreferences.js';

test('Satellite includes labels and photorealistic 3D is a separate appearance', () => {
  const satellite = MAP_TYPE_OPTIONS.find((option) => option.label === 'Satellite');
  assert.equal(satellite.value, 'hybrid');
  assert.equal(normalizeMapPreferences({ type: satellite.value }).type, 'hybrid');
  assert.deepEqual(MAP_TYPE_OPTIONS.map((option) => option.label), ['Road', 'Satellite', 'Terrain', '3D']);
  assert.equal(MAP_TYPES.includes('satellite'), false);
});
test('legacy unlabelled preferences migrate to labelled satellite without changing theme', () => {
  assert.deepEqual(normalizeMapPreferences({ type: 'satellite', theme: 'dark' }), { type: 'hybrid', theme: 'dark', routes: 'off' });
});

test('missing or invalid preferences fall back to the existing appearance', () => {
  for (const input of [null, {}, { theme: 'invalid', type: 'invalid' }, 'corrupt']) {
    assert.deepEqual(normalizeMapPreferences(input), { theme: 'auto', type: 'roadmap', routes: 'off' });
  }
});
test('explicit map themes override the app theme in either direction', () => {
  assert.equal(mapColorScheme('light', 'DARK'), 'LIGHT');
  assert.equal(mapColorScheme('dark', 'LIGHT'), 'DARK');
  assert.equal(mapColorScheme('auto', 'DARK'), 'DARK');
  assert.equal(mapColorScheme('auto', 'LIGHT'), 'LIGHT');
});
test('all supported map types survive the persisted JSON round trip', () => {
  for (const type of MAP_TYPES) {
    const saved = { theme: 'light', type, routes: 'off' };
    assert.deepEqual(normalizeMapPreferences(JSON.parse(JSON.stringify(saved))), saved);
  }
});
test('routes between stops are off until chosen, and keep whichever way was chosen', () => {
  assert.equal(normalizeMapPreferences({}).routes, 'off');
  assert.deepEqual(MAP_ROUTES, ['off', 'auto', 'WALK', 'TRANSIT', 'DRIVE']);
  for (const routes of MAP_ROUTES) {
    assert.equal(normalizeMapPreferences(JSON.parse(JSON.stringify({ routes }))).routes, routes);
  }
  assert.equal(normalizeMapPreferences({ routes: 'BICYCLE' }).routes, 'off');
});
