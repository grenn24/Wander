import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeTopology, splitAtDateLine, ringArea, prepareCountries, countryAt, regionsFor, regionStrength,
} from '../lib/globeRegions.js';

const world = prepareCountries(JSON.parse(readFileSync(new URL('../public/geo/countries-50m.json', import.meta.url), 'utf8')));
const nameAt = (lat, lng) => { const hit = countryAt({ lat, lng }, world); return hit ? hit.country.name : null; };

test('TopoJSON arcs join into rings, walked backwards where the index says so', () => {
  const topology = {
    transform: { scale: [1, 1], translate: [0, 0] },
    arcs: [[[0, 0], [2, 0], [0, 2]], [[2, 2], [-2, 0], [0, -2]]],
    objects: { countries: { geometries: [{ type: 'Polygon', id: '1', properties: { name: 'Square' }, arcs: [[0, 1]] }] } },
  };
  const [sq] = decodeTopology(topology);
  assert.equal(sq.name, 'Square');
  assert.deepEqual(sq.polygons[0][0], [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]);
  const back = decodeTopology({ ...topology, objects: { countries: { geometries: [{ type: 'Polygon', id: '2', arcs: [[~1, ~0]] }] } } });
  assert.deepEqual(back[0].polygons[0][0], [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]);
});

test('an island across the date line is cut in two, not wrapped round the Earth', () => {
  const ring = [[179, -17], [-179, -17], [-179, -16], [179, -16], [179, -17]];
  const pieces = splitAtDateLine(ring);
  assert.equal(pieces.length, 2);
  pieces.forEach((p) => p.forEach(([lng]) => assert.ok(Math.abs(lng) >= 179 && Math.abs(lng) <= 180)));
  const total = pieces.reduce((n, p) => n + ringArea(p), 0);
  const whole = ringArea([[179, -17], [181, -17], [181, -16], [179, -16], [179, -17]]);
  assert.ok(Math.abs(total - whole) / whole < 0.001);
  const plain = [[10, 10], [11, 10], [11, 11], [10, 10]];
  assert.deepEqual(splitAtDateLine(plain), [plain]);
});

test('Fiji is the size of Fiji once its date-line island is cut', () => {
  const fiji = world.find((c) => c.name === 'Fiji');
  const area = fiji.parts.reduce((n, p) => n + p.area, 0);
  // About 18,300 km² of land; a wrapped ring measured over 140,000.
  assert.ok(area > 12000 && area < 25000, `Fiji measured ${Math.round(area)} km²`);
  fiji.parts.forEach((p) => p.outer.forEach(([lng]) => assert.ok(lng >= -180 && lng <= 180)));
});

test('places land in their countries, and a place just offshore in the nearest', () => {
  assert.equal(nameAt(35.0116, 135.7681), 'Japan'); // Kyoto
  assert.equal(nameAt(-18.1416, 178.4419), 'Fiji'); // Suva
  assert.equal(nameAt(1.2903, 103.852), 'Singapore');
  assert.equal(nameAt(25.033, 121.5654), 'Taiwan');
  assert.equal(nameAt(-33.4489, -70.6693), 'Chile');
  assert.equal(nameAt(35.45, 139.8), 'Japan'); // the middle of Tokyo Bay
  assert.equal(nameAt(-30, -140), null); // the South Pacific
});

test('regions: been wins over planned, small islands go unless visited, tiny countries keep their pins', () => {
  const pts = [
    { id: 'kyoto', kind: 'been', lat: 35.0116, lng: 135.7681 },
    { id: 'naha', kind: 'planned', lat: 26.2124, lng: 127.6809 },
    { id: 'sg', kind: 'been', lat: 1.2903, lng: 103.852 },
    { id: 'idea', kind: 'idea', lat: 36, lng: 138 },
    { id: 'want', kind: 'want', lat: 48.8566, lng: 2.3522 },
  ];
  const regions = regionsFor(pts, world);
  assert.deepEqual(regions.map((r) => r.name).sort(), ['Japan', 'Singapore']);
  const japan = regions.find((r) => r.name === 'Japan');
  assert.equal(japan.kind, 'been');
  assert.deepEqual(japan.points.map((p) => p.id), ['kyoto', 'naha']);
  assert.deepEqual(japan.covered.sort(), ['kyoto', 'naha']);
  const okinawa = japan.parts.find((p) => p.outer.some(([lng, lat]) => Math.abs(lat - 26.5) < 0.6 && Math.abs(lng - 127.9) < 0.6));
  assert.ok(okinawa, 'Okinawa is drawn because a trip goes there');
  assert.ok(japan.parts.length < world.find((c) => c.name === 'Japan').parts.length);
  const sg = regions.find((r) => r.name === 'Singapore');
  assert.deepEqual(sg.covered, []);
});

test('regions show fully far out, fade on the way in, and are gone up close', () => {
  assert.equal(regionStrength(20000000), 1);
  assert.equal(regionStrength(2500000), 1);
  assert.equal(regionStrength(1600000), 0.6);
  assert.equal(regionStrength(700000), 0);
  assert.equal(regionStrength(45000), 0);
});
