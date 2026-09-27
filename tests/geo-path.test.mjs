import test from 'node:test';
import assert from 'node:assert/strict';
import { thinPath, haversine } from '../lib/geo.js';

test('a route keeps its shape with the points a map cannot show taken out', () => {
  // A kilometre of road sampled every 5 m, as Google returns a drive.
  const dense = Array.from({ length: 200 }, (_, i) => ({ lat: 35.68 + i * 0.000045, lng: 139.76 }));
  const thin = thinPath(dense, 15);
  assert.ok(thin.length < dense.length / 2, `kept ${thin.length} of ${dense.length}`);
  // The ends are where they were, so the line still meets its stops.
  assert.deepEqual(thin[0], dense[0]);
  assert.deepEqual(thin[thin.length - 1], dense[dense.length - 1]);
  // And nothing kept is nearer than asked, so nothing is drawn twice.
  for (let i = 1; i < thin.length - 1; i += 1) {
    assert.ok(haversine(thin[i - 1].lat, thin[i - 1].lng, thin[i].lat, thin[i].lng) * 1000 >= 15);
  }
});

test('a corner is kept, and a short way is left alone', () => {
  // Three points far apart: nothing to drop.
  const corner = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0.01, lng: 0.01 }];
  assert.deepEqual(thinPath(corner, 15), corner);
  assert.deepEqual(thinPath([{ lat: 1, lng: 1 }], 15), [{ lat: 1, lng: 1 }]);
  assert.deepEqual(thinPath(null), []);
  // Anything without coordinates is not a point on a route.
  assert.deepEqual(thinPath([{ lat: 1, lng: 1 }, { lat: null, lng: 2 }, { lat: 3, lng: 3 }], 15),
    [{ lat: 1, lng: 1 }, { lat: 3, lng: 3 }]);
});
