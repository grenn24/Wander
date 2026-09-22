import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPixel, clusterUnits, clusterScreen, projectToScreen } from '../lib/mapClusters.js';

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

test('the 3D camera puts places where the live map drew them', () => {
  // Measured on the 3D map: 1856 × 1214 px, looking at Tokyo Bay from 10 km.
  const at = { lat: 35.52, lng: 139.93 };
  const north = { lat: 35.52 + 2000 / 111320, lng: 139.93 };
  const east = { lat: 35.52, lng: 139.93 + 2000 / (111320 * Math.cos(35.52 * Math.PI / 180)) };
  const near = (p, x, y) => Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2;
  // Straight down: the centre in the middle, 2 km north 384 px above it.
  const down = { ...at, altitude: 0, range: 10000, tilt: 0, heading: 0 };
  assert.ok(near(projectToScreen(down, at, 1856, 1214), 928, 607));
  assert.ok(near(projectToScreen(down, north, 1856, 1214), 928, 222.5));
  // Tilted 55° and turned 30°, as the markers drew.
  const tilted = { ...down, tilt: 55, heading: 30 };
  assert.ok(near(projectToScreen(tilted, north, 1856, 1214), 759.6, 439.5));
  assert.ok(near(projectToScreen(tilted, east, 1856, 1214), 1235.9, 504.8));
  // Behind the camera there is nothing to draw.
  const level = { ...down, tilt: 89, heading: 0 };
  assert.equal(projectToScreen(level, { lat: 35.3, lng: 139.93 }, 1856, 1214), null);
});

test('stops placed on the screen gather the same way', () => {
  const units = [
    { key: 'a', x: 100, y: 100, radius: 13, weight: 1, lat: 1, lng: 1 },
    { key: 'b', x: 120, y: 105, radius: 13, weight: 1, lat: 2, lng: 2 },
    { key: 'c', x: 400, y: 100, radius: 13, weight: 1, lat: 3, lng: 3 },
  ];
  assert.deepEqual(clusterScreen(units).map((g) => g.keys), [['a', 'b'], ['c']]);
});

test('the same camera, however the map describes it, puts places in the same spots', () => {
  // On the ground: Tokyo station from 12 km, tilted 60°, turned 20°.
  const ground = { lat: 35.681, lng: 139.767, altitude: 0, range: 12000, tilt: 60, heading: 20 };
  // The same eye as a point 5 km further along the view, underground, seen from 17 km.
  const t = 60 * Math.PI / 180;
  const h = 20 * Math.PI / 180;
  const d = 5000;
  const under = {
    lat: 35.681 + (d * Math.sin(t) * Math.cos(h)) / 111320,
    lng: 139.767 + (d * Math.sin(t) * Math.sin(h)) / (111320 * Math.cos(35.681 * Math.PI / 180)),
    altitude: -d * Math.cos(t), range: 12000 + d, tilt: 60, heading: 20,
  };
  const places = [
    { lat: 35.6717, lng: 139.7650, altitude: 0 },
    { lat: 35.7148, lng: 139.7967, altitude: 0 },
    { lat: 35.6896, lng: 139.7006, altitude: 0 },
  ];
  places.forEach((place) => {
    const a = projectToScreen(ground, place, 1600, 1000);
    const b = projectToScreen(under, place, 1600, 1000);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 3, `${place.lat}: ${a.x},${a.y} vs ${b.x},${b.y}`);
  });
  // Placed at the underground centre's height instead, they land somewhere else entirely.
  const wrong = projectToScreen(under, { lat: 35.6717, lng: 139.7650 }, 1600, 1000);
  const right = projectToScreen(ground, places[0], 1600, 1000);
  assert.ok(!wrong || Math.hypot(wrong.x - right.x, wrong.y - right.y) > 50);
});
