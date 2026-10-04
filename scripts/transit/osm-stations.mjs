/*
 * Station exits and platforms from OpenStreetMap (ODbL), for a country in
 * the registry (data/transit/registry/<cc>.json):
 *
 *   exits   every station entrance with a number or a name: "Exit A2",
 *           "North Exit"; the walk off a train leaves by the one nearest
 *           where it is going (lib/stationDetails)
 *   routes  each railway route's stops in order, with the platform it uses
 *           at each where that is mapped: a stop position's local_ref or
 *           railway:track_ref, else its platform's; "1 or 2" where the
 *           platform carries both sides' numbers. The route's operator is the
 *           registry's, found by its Wikidata id (operator:wikidata) or name.
 *
 * Writes data/transit/stations/<cc>.json:
 *
 *   { source, exits: [[lat, lng, label]], routes: [{ op, names, stops: [[lat, lng, platform]] }] }
 *
 * with only the routes that have a platform. From Overpass, two queries with
 * long timeouts; or, where Overpass cannot be reached, from regional extracts
 * read by scripts/transit/osm-extract.py, which gives the same elements.
 *
 *   node scripts/transit/osm-stations.mjs jp [south,west,north,east]
 *   node scripts/transit/osm-stations.mjs jp --from kanto.json kansai.json ...
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cc = (process.argv[2] || '').toLowerCase();
if (!/^[a-z]{2}$/.test(cc)) {
  console.error('Usage: node scripts/transit/osm-stations.mjs <country code> [south,west,north,east]');
  process.exit(1);
}
const rest = process.argv.slice(3);
const from = rest[0] === '--from' ? rest.slice(1) : [];
const bbox = from.length ? null : rest[0] || null;
const root = new URL('../../', import.meta.url);
const registry = JSON.parse(readFileSync(new URL(`data/transit/registry/${cc}.json`, root), 'utf8'));
const UA = 'WanderTripPlanner/1.0 (station exits and platforms; https://github.com/grenn24/Wander)';

function overpass(query) {
  for (let wait = 30; wait <= 480; wait *= 2) {
    try {
      const out = execFileSync('curl', ['-sS', '--max-time', '900', '-H', `User-Agent: ${UA}`,
        '--data-urlencode', `data=${query}`, '-w', '\n%{http_code}', 'https://overpass-api.de/api/interpreter'],
      { encoding: 'utf8', maxBuffer: 1 << 30 });
      const cut = out.lastIndexOf('\n');
      if (out.slice(cut + 1) === '200') return JSON.parse(out.slice(0, cut)).elements;
      console.error(`  Overpass ${out.slice(cut + 1)}, waiting ${wait}s`);
    } catch (e) {
      console.error(`  ${String(e.stderr || e.message).trim().split('\n')[0]}, waiting ${wait}s`);
    }
    execFileSync('sleep', [String(wait)]);
  }
  throw new Error('Overpass did not answer.');
}

// The whole country, or a box of it for a trial.
const where = bbox ? `(${bbox})` : '(area.c)';
const head = `[out:json][timeout:900][maxsize:2000000000];${bbox ? '' : `area["ISO3166-1"="${registry.country}"][admin_level=2]->.c;`}`;

/* ------------------------------------------------------------------ exits -- */

// Exits named in words, as Japanese stations name them.
const SIDES = { 東: 'East', 西: 'West', 南: 'South', 北: 'North', 中央: 'Central' };
function exitLabel(tags) {
  const ref = (tags.ref || tags['railway:ref'] || '').trim();
  if (ref && /^[A-Za-z]?\d+[A-Za-z]?(-\d+)?$|^[A-Za-z]\d*[a-z]?$/.test(ref)) return `Exit ${ref}`;
  const en = (tags['name:en'] || '').trim();
  if (en && /exit|entrance/i.test(en) && en.length <= 24) return en.replace(/\bEntrance\b/i, 'Exit');
  const ja = (tags.name || ref || '').replace(/改札|出入口|出口/g, '口').trim();
  const m = /^(?:.*駅)?\s*(東|西|南|北|中央)(東|西|南|北)?口$/.exec(ja);
  if (m) return `${m[2] ? `${SIDES[m[1]]}${SIDES[m[2]].toLowerCase()}` : SIDES[m[1]]} Exit`;
  return null;
}

// The extracts' elements, each once (the regions overlap at their edges).
let extracted = null;
if (from.length) {
  const seen = new Map();
  for (const file of from) {
    for (const e of JSON.parse(readFileSync(file, 'utf8')).elements) seen.set(`${e.type}/${e.id}`, e);
  }
  extracted = [...seen.values()];
  console.log(`${extracted.length} elements from ${from.length} extracts`);
}

const round = (v) => Math.round(v * 1e5) / 1e5;
console.log('Exits…');
const ENTRANCE = /^(subway_entrance|train_station_entrance)$/;
const entrances = extracted
  ? extracted.filter((e) => e.type === 'node' && ENTRANCE.test((e.tags || {}).railway || ''))
  : overpass(`${head}node${where}["railway"~"^(subway_entrance|train_station_entrance)$"];out tags;`);
const exits = [];
for (const e of entrances) {
  const label = exitLabel(e.tags || {});
  if (label) exits.push([round(e.lat), round(e.lon), label]);
}
console.log(`  ${entrances.length} entrances, ${exits.length} with a number or a name`);

/* ---------------------------------------------------------------- routes -- */

const byWikidata = new Map(registry.operators.filter((o) => o.wikidata).map((o) => [o.wikidata, o.id]));
const byName = new Map();
registry.operators.forEach((o) => [o.name, o.local, ...(o.aliases || [])].forEach((n) => n && byName.set(n, o.id)));
const operatorOf = (tags) => {
  for (const q of (tags['operator:wikidata'] || '').split(';')) if (byWikidata.has(q.trim())) return byWikidata.get(q.trim());
  for (const n of (tags.operator || '').split(';')) if (byName.has(n.trim())) return byName.get(n.trim());
  return null;
};

/*
 * A platform's number: one, or "1 or 2" where it lists both sides. A number
 * starts with a digit ("3", "10", "1A"): a stop's ref is as often its
 * station's number on the signs ("Y10", "JY01"), which is not a platform.
 */
function platformOf(tags) {
  for (const key of ['local_ref', 'railway:track_ref', 'ref']) {
    const value = (tags[key] || '').replace(/番線?$/, '').trim();
    if (!value || value.length > 12) continue;
    const parts = value.split(/[;,/・]/).map((p) => p.replace(/番線?$/, '').trim()).filter((p) => /^\d{1,2}[A-Za-z]?$/.test(p));
    if (parts.length) return parts.length === 1 ? parts[0] : parts.slice(0, 2).join(' or ');
  }
  return null;
}

console.log('Routes and platforms…');
const elements = extracted || overpass(`${head}rel${where}["type"="route"]["route"~"^(train|subway|light_rail|monorail|tram)$"]->.r;.r out body;`
  + '(node(r.r:"stop");node(r.r:"stop_entry_only");node(r.r:"stop_exit_only");'
  + 'node(r.r:"platform");way(r.r:"platform");node(r.r:"platform_entry_only");way(r.r:"platform_entry_only");'
  + 'node(r.r:"platform_exit_only");way(r.r:"platform_exit_only"););out tags center;');
const things = new Map(elements.filter((e) => e.type !== 'relation').map((e) => [`${e.type}/${e.id}`, e]));
const at = (e) => (e.center ? [e.center.lat, e.center.lon] : [e.lat, e.lon]);
const near = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.82) < 0.002; // ~200 m

const routes = [];
for (const rel of elements.filter((e) => e.type === 'relation')) {
  const tags = rel.tags || {};
  // Stops in order: each stop position, with the platform listed with it where its own number is missing.
  const stops = [];
  for (const m of rel.members || []) {
    const e = things.get(`${m.type}/${m.ref}`);
    if (!e || !/^(stop|platform)/.test(m.role)) continue;
    const p = at(e);
    if (p[0] == null) continue;
    const label = platformOf(e.tags || {});
    const last = stops[stops.length - 1];
    if (last && near(last, p)) {
      if (!last[2] && label) last[2] = label;
      continue;
    }
    stops.push([round(p[0]), round(p[1]), label]);
  }
  if (stops.length < 2 || !stops.some((s) => s[2])) continue;
  const names = [...new Set([tags.name, tags['name:en'], tags['name:ja'], tags.ref].filter(Boolean))];
  routes.push({ op: operatorOf(tags), names, stops });
}
console.log(`  ${routes.length} routes with a platform, ${routes.filter((r) => r.op).length} of them by a known operator`);

mkdirSync(new URL('data/transit/stations/', root), { recursive: true });
const out = {
  source: { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0', built: new Date().toISOString().slice(0, 10) },
  exits,
  routes,
};
writeFileSync(new URL(`data/transit/stations/${cc}.json`, root), JSON.stringify(out));
writeFileSync(new URL('data/transit/stations/LICENSE', root), 'The stations files here are derived from OpenStreetMap,\n'
  + '© OpenStreetMap contributors, https://www.openstreetmap.org/copyright.\n'
  + 'They are made available under the Open Database License 1.0: https://opendatacommons.org/licenses/odbl/1-0/.\n');
console.log(`data/transit/stations/${cc}.json: ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB`);
