import test from 'node:test';
import assert from 'node:assert/strict';
import { fit3DCamera, rangeToZoom, validMapPoint, viewport3D, zoomToRange } from '../lib/map3dCamera.js';

test('switching 2D and 3D preserves the ground scale across latitudes and phone sizes', () => {
  for (const lat of [0, 35.68, -60, 85]) for (const height of [320, 844]) for (const zoom of [9, 14, 17]) {
    const range = zoomToRange(zoom, lat, height);
    if (range > 150) assert.ok(Math.abs(rangeToZoom(range, lat, height) - zoom) < 0.001);
  }
});

test('fitting stops spans the date line without jumping to the opposite side of Earth', () => {
  const fit = fit3DCamera([{ lat: -17, lng: 179.8 }, { lat: -17.5, lng: -179.9 }]);
  assert.ok(Math.abs(fit.center.lng) > 179);
  assert.ok(fit.range < 200000);
});

test('empty and invalid coordinates get a safe starting view, including zero coordinates', () => {
  assert.equal(zoomToRange(14, 35, 0), zoomToRange(14, 35, 600));
  assert.equal(validMapPoint({ lat: 0, lng: 0 }), true);
  assert.equal(validMapPoint({ lat: null, lng: 3 }), false);
  assert.equal(validMapPoint({ lat: 91, lng: 3 }), false);
  assert.deepEqual(fit3DCamera([{ lat: NaN, lng: 0 }], { lat: 0, lng: 0 }).center, { lat: 0, lng: 0 });
  assert.ok(Number.isFinite(fit3DCamera([]).range));
});

test('phone framing fits the same stops at a wider range and clamps polar search bounds', () => {
  const stops = [{ lat: 35.68, lng: 139.7 }, { lat: 35.7, lng: 139.8 }];
  assert.ok(fit3DCamera(stops, null, 0.5).range > fit3DCamera(stops, null, 2).range);
  const view = viewport3D({ lat: 89.9, lng: 179.9 }, 1000000);
  assert.equal(view.radius, 50000);
  assert.ok(view.bounds.north <= 90 && view.bounds.east <= 180 && view.bounds.west >= -180);
  assert.equal(viewport3D({ lat: NaN, lng: 0 }, 500), null);
});
