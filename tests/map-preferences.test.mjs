import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMapPreferences, mapColorScheme, MAP_TYPES, MAP_TYPE_OPTIONS } from '../lib/mapPreferences.js';

test('Satellite is the only imagery option and always includes labels', () => {
  const satellite = MAP_TYPE_OPTIONS.find((option) => option.label === 'Satellite');
  assert.equal(satellite.value, 'hybrid');
  assert.equal(normalizeMapPreferences({ type: satellite.value }).type, 'hybrid');
  assert.deepEqual(MAP_TYPE_OPTIONS.map((option) => option.label), ['Road', 'Satellite', 'Terrain']);
  assert.equal(MAP_TYPES.includes('satellite'), false);
});
test('legacy unlabelled preferences migrate to labelled satellite without changing theme', () => {
  assert.deepEqual(normalizeMapPreferences({ type: 'satellite', theme: 'dark' }), { type: 'hybrid', theme: 'dark' });
});

test('missing or invalid preferences fall back to the existing appearance', () => {
  for (const input of [null, {}, { theme: 'invalid', type: 'invalid' }, 'corrupt']) {
    assert.deepEqual(normalizeMapPreferences(input), { theme: 'auto', type: 'roadmap' });
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
    const saved = { theme: 'light', type };
    assert.deepEqual(normalizeMapPreferences(JSON.parse(JSON.stringify(saved))), saved);
  }
});
