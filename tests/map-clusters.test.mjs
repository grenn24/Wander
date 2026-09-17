import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPixel, clusterUnits } from '../lib/mapClusters.js';

// Tsukiji, Ginza and Senso-ji: 1 km and 4 km apart.
const tsukiji = { lat: 35.6654, lng: 139.7707 };
const ginza = { lat: 35.6717, lng: 139.7650 };
const sensoji = { lat: 35.7148, lng: 139.7967 };
const unit = (key, at, extra = {}) => ({ key, ...at, radius: 13, weight: 1, ...extra });

test('world pixels double with each zoom', () => {
  const a = worldPixel(tsukiji.lat, tsukiji.lng, 12);
  const b = worldPixel(tsukiji.lat, tsukiji.lng, 13);
  assert.ok(Math.abs(b.x - 2 * a.x) < 1e-6 && Math.abs(b.y - 2 * a.y) < 1e-6);
  // The equator and the date line sit where Web Mercator puts them.
  const origin = worldPixel(0, 0, 0);
  assert.ok(Math.abs(origin.x - 128) < 1e-9 && Math.abs(origin.y - 128) < 1e-9);
});

test('pins that would overlap gather, and come apart again closer in', () => {
  const units = [unit(0, tsukiji), unit(1, ginza), unit(2, sensoji)];
  // Zoomed out over the region, all three pile up.
  const far = clusterUnits(units, 8);
  assert.deepEqual(far.map((g) => g.keys), [[0, 1, 2]]);
  assert.equal(far[0].weight, 3);
  // Over the city, Tsukiji and Ginza are 28 px apart and touch; Senso-ji stands apart.
  assert.deepEqual(clusterUnits(units, 12).map((g) => g.keys), [[0, 1], [2]]);
  // One step closer they are 56 px apart, and every stop has its own pin.
  assert.deepEqual(clusterUnits(units, 13).map((g) => g.keys), [[0], [1], [2]]);
});

test('a chosen stop stays out of every cluster', () => {
  const units = [unit(0, tsukiji), unit(1, ginza, { alone: true }), unit(2, sensoji)];
  assert.deepEqual(clusterUnits(units, 8).map((g) => g.keys), [[0, 2], [1]]);
});

test('a cluster sits at the middle of its stops, weighted by how many each unit holds', () => {
  // A fan of three at Tsukiji and one stop at Ginza.
  const units = [unit(0, tsukiji, { weight: 3, radius: 30 }), unit(1, ginza)];
  const [g] = clusterUnits(units, 12);
  assert.deepEqual(g.keys, [0, 1]);
  assert.equal(g.weight, 4);
  assert.ok(Math.abs(g.lat - (tsukiji.lat * 3 + ginza.lat) / 4) < 1e-9);
  assert.ok(Math.abs(g.lng - (tsukiji.lng * 3 + ginza.lng) / 4) < 1e-9);
});
