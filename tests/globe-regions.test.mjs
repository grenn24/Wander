import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeTopology, splitAtDateLine, ringArea, prepareCountries, countryAt, regionsFor, regionStrength,
  prepareAreas, shapeAt, areaFilesFor, areaStrength,
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

// Natural Earth spells names as they are written there: Kyōto, Ōita.
const plain = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '');
const areaFile = (code) => JSON.parse(readFileSync(new URL(`../public/geo/areas/${code}.json`, import.meta.url), 'utf8'));
const areaIndex = JSON.parse(readFileSync(new URL('../public/geo/areas/index.json', import.meta.url), 'utf8'));

test('a place is found in its prefecture, not just its country', () => {
  const japan = prepareAreas(areaFile('JPN'), 'JPN');
  assert.equal(japan.length, 47);
  const at = (lat, lng) => { const hit = shapeAt({ lat, lng }, japan, 15); return hit ? plain(hit.shape.name) : null; };
  assert.equal(at(35.0116, 135.7681), 'Kyoto Prefecture');
  assert.equal(at(35.6895, 139.6917), 'Tokyo');
  assert.equal(at(35.2324, 139.1069), 'Kanagawa Prefecture'); // Hakone
  assert.equal(at(43.0618, 141.3545), 'Hokkaido');
  assert.equal(at(26.2124, 127.6809), 'Okinawa Prefecture');
});

test('only the area files a trip needs are fetched', () => {
  const pts = [
    { kind: 'been', lat: 35.0116, lng: 135.7681 }, // Kyoto
    { kind: 'planned', lat: 48.8566, lng: 2.3522 }, // Paris
    { kind: 'want', lat: -33.8688, lng: 151.2093 }, // Sydney, only wanted: no fill, no file
    { kind: 'idea', lat: 64.1466, lng: -21.9426 },
  ];
  assert.deepEqual(areaFilesFor(pts, areaIndex), ['FRA', 'JPN']);
});

test('the prefectures you went to are filled, and the country is only outlined', () => {
  const areas = prepareAreas(areaFile('JPN'), 'JPN');
  const pts = [
    { id: 'tokyo', kind: 'been', lat: 35.6895, lng: 139.6917 },
    { id: 'kyoto', kind: 'been', lat: 35.0116, lng: 135.7681 },
    { id: 'hakone', kind: 'planned', lat: 35.2324, lng: 139.1069 },
  ];
  const regions = regionsFor(pts, world, areas);
  const country = regions.filter((r) => r.level === 'country');
  const filled = regions.filter((r) => r.level === 'area');
  assert.equal(country.length, 1);
  assert.equal(country[0].name, 'Japan');
  assert.equal(country[0].filled, false);
  assert.deepEqual(country[0].covered.sort(), ['hakone', 'kyoto', 'tokyo']);
  assert.deepEqual(filled.map((r) => [plain(r.name), r.kind]).sort(), [
    ['Kanagawa Prefecture', 'planned'], ['Kyoto Prefecture', 'been'], ['Tokyo', 'been'],
  ]);
  // Tokyo's islands reach a thousand kilometres south; only the part you went to is drawn.
  const tokyo = filled.find((r) => r.name === 'Tokyo');
  tokyo.parts.forEach((part) => part.outer.forEach(([, lat]) => assert.ok(lat > 34.5, `a Tokyo island at ${lat}°`)));
  // Without area data the country is filled, as before, rather than showing nothing.
  const fallback = regionsFor(pts, world, []);
  assert.deepEqual(fallback.map((r) => [r.level, r.filled]), [['country', true]]);
});

test('an area shows while it is a shape in the view and fades once you are inside it', () => {
  const kyoto = 4612; // km²
  assert.equal(areaStrength(kyoto, 17000000), 1); // from space
  assert.equal(areaStrength(kyoto, 640000), 1); // Tokyo to Kyoto in view
  assert.equal(areaStrength(kyoto, 45000), 0); // a street in Kyoto
  const between = areaStrength(kyoto, 180000);
  assert.ok(between > 0 && between < 1, `half-way was ${between}`);
  const westernAustralia = 2527000;
  assert.equal(areaStrength(westernAustralia, 640000), 0);
  assert.equal(areaStrength(westernAustralia, 17000000), 1);
});
