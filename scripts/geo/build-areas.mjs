/*
 * The globe's prefectures, states and provinces, one small file per country.
 *
 * The source is Natural Earth's first-level administrative areas at 1:10
 * million — public domain, 4,596 areas in 251 countries, 41 MB of GeoJSON. Far
 * too much to send to a browser, and almost all of it about countries nobody
 * has been to. So each country becomes its own TopoJSON file, simplified to
 * the detail a region needs to be recognisable on a globe, and an index says
 * roughly where each country's areas lie so the page can fetch only the files
 * for places someone has been.
 *
 * Run it again when Natural Earth publishes a new edition:
 *
 *   curl -L -o ne.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
 *   node scripts/geo/build-areas.mjs ne.geojson
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { topology } from 'topojson-server';
import { presimplify, quantile, simplify, sphericalTriangleArea } from 'topojson-simplify';
import { quantize } from 'topojson-client';

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/geo/build-areas.mjs ne_10m_admin_1_states_provinces.geojson');
  process.exit(1);
}
const out = new URL('../../public/geo/areas/', import.meta.url);

// About this many points per country after simplifying: Japan's 47 prefectures
// stay recognisable in 84 KB, and the largest, Russia, comes to about 600 KB.
const POINTS_PER_COUNTRY = 14000;
// Coordinates are rounded to about 200 m, which no one will see from orbit.
const STEP_DEGREES = 0.002;

const rings = (g) => (g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);

/*
 * Where a country's areas are, as a few boxes rather than one. One box for
 * Russia would reach round the world at 180°, and one for France would take
 * in the Atlantic between Paris and Guadeloupe, so every area gets a box —
 * split at the date line where an area crosses it — and boxes that overlap
 * are merged until none do.
 */
function boxesOf(features) {
  const boxes = [];
  features.forEach((f) => {
    const east = [180, 90, -180, -90];
    const west = [180, 90, -180, -90];
    let crosses = false;
    rings(f.geometry).forEach((ring) => ring.forEach(([lng, lat], i) => {
      if (i && Math.abs(lng - ring[i - 1][0]) > 180) crosses = true;
      const b = lng >= 0 ? east : west;
      b[0] = Math.min(b[0], lng); b[1] = Math.min(b[1], lat);
      b[2] = Math.max(b[2], lng); b[3] = Math.max(b[3], lat);
    }));
    const valid = (b) => b[0] <= b[2];
    // Chukotka is stored as pieces either side of 180°, so no ring jumps it —
    // but its western pieces end near -169° and its eastern ones start near
    // 172°, and nothing between is land. An area that really spans 0°, like
    // France, has no such gap.
    if (valid(east) && valid(west) && east[0] - west[2] > 180) crosses = true;
    if (!crosses && valid(east) && valid(west)) {
      boxes.push([west[0], Math.min(east[1], west[1]), east[2], Math.max(east[3], west[3])]);
    } else {
      [east, west].filter(valid).forEach((b) => boxes.push(b));
    }
  });
  const overlap = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (!overlap(boxes[i], boxes[j])) continue;
        const [a, b] = [boxes[i], boxes[j]];
        boxes[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
        boxes.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return boxes.map((b) => b.map((v) => Math.round(v * 100) / 100));
}

const all = JSON.parse(readFileSync(source, 'utf8')).features.filter((f) => f.geometry);
const byCountry = new Map();
all.forEach((f) => {
  const code = f.properties.adm0_a3;
  if (!code || code === '-99') return;
  if (!byCountry.has(code)) byCountry.set(code, []);
  byCountry.get(code).push(f);
});

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const index = {};
let bytes = 0;
[...byCountry.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([code, features]) => {
  const collection = {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      id: f.properties.adm1_code,
      properties: { name: f.properties.name_en || f.properties.name || '', type: f.properties.type_en || '' },
      geometry: f.geometry,
    })),
  };
  let t = topology({ areas: collection });
  const points = t.arcs.reduce((n, arc) => n + arc.length, 0);
  if (points > POINTS_PER_COUNTRY) {
    t = presimplify(t, sphericalTriangleArea);
    t = simplify(t, quantile(t, 1 - POINTS_PER_COUNTRY / points));
  }
  const [x0, y0, x1, y1] = t.bbox;
  const q = Math.min(100000, Math.max(1000, Math.ceil(Math.max(x1 - x0, y1 - y0) / STEP_DEGREES)));
  t = quantize(t, q);
  delete t.bbox;
  const json = JSON.stringify(t);
  writeFileSync(new URL(`${code}.json`, out), json);
  bytes += json.length;
  index[code] = boxesOf(features);
});

writeFileSync(new URL('index.json', out), JSON.stringify(index));
writeFileSync(new URL('SOURCE.txt', out), [
  'First-level administrative areas (prefectures, states, provinces), one file per country.',
  'From Natural Earth, ne_10m_admin_1_states_provinces, which is in the public domain:',
  'https://www.naturalearthdata.com/about/terms-of-use/',
  'Simplified and split by scripts/geo/build-areas.mjs; do not edit by hand.',
  '',
].join('\n'));
console.log(`${byCountry.size} countries, ${all.length} areas, ${(bytes / 1e6).toFixed(2)} MB of area files`);
