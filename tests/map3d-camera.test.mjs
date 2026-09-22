import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backOff, coverPadding, fit3DCamera, rangeToZoom, validMapPoint, viewport3D, zoomToRange,
} from '../lib/map3dCamera.js';

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

test('a fit leaves room for the controls over the map, unless that leaves too little', () => {
  // The day chips across the top and the stops panel down the right of a wide window.
  assert.deepEqual(coverPadding(1870, 947, { top: 60, right: 380 }), { top: 108, right: 428, bottom: 48, left: 48 });
  // A phone with its sheet pulled up: fit to the whole map instead.
  assert.equal(coverPadding(390, 700, { bottom: 480 }), null);
  assert.deepEqual(coverPadding(390, 700, null, 0), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('backing out of a fit keeps the stops where the fit put them on the screen', () => {
  // The fit centred the map 0.004 east of the stops, to put them left of the panel, at zoom 18.
  const centre = backOff({ lat: 35.55, lng: 139.784 }, { lat: 35.55, lng: 139.78 }, 18, 16);
  // Four times the ground per pixel at 16: the same pixels from the stops are four times the degrees.
  assert.ok(Math.abs(centre.lng - 139.796) < 1e-9);
  assert.equal(centre.lat, 35.55);
});

test('3D framing puts the stops in the middle of the open part of the map', () => {
  // Two stops 3.6 km apart east to west, on a wide window with the panel down the right.
  const stops = [{ lat: 35.55, lng: 139.76 }, { lat: 35.55, lng: 139.8 }];
  const whole = fit3DCamera(stops, null, 1870 / 947);
  const open = fit3DCamera(stops, null, 1870 / 947, { width: 1870, height: 947, top: 60, right: 380 });
  // Framed into less of the map, so from further away...
  assert.ok(open.range > whole.range);
  // ...and the camera aimed east of the stops, so they sit left of the panel.
  assert.ok(open.center.lng > whole.center.lng);
  // With the chips across the top, aimed north a little, so they sit a little lower.
  assert.ok(open.center.lat > whole.center.lat);
  // Nothing over the map, the same as without a frame.
  assert.deepEqual(fit3DCamera(stops, null, 1870 / 947, { width: 1870, height: 947 }).center, whole.center);
});
