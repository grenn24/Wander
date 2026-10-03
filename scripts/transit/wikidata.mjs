/*
 * English names for Japan's stations and lines, from Wikidata (CC0).
 *
 * The nationwide railway data names everything in Japanese only. Wikidata
 * has nearly every station in Japan with its English label, its position,
 * and the lines it is on, which is how build-japan.mjs matches lines too.
 * One query for the whole country times out, so it asks one square degree at
 * a time — only those with stations in data/transit/japan-rail.json — using
 * the query service's spatial index.
 *
 *   node scripts/transit/wikidata.mjs <folder>
 *   node scripts/transit/build-japan.mjs <honsu folder> <mini-tokyo-3d> --wikidata <folder>
 *
 * It uses curl rather than fetch so it goes through a proxy where one is set.
 * Squares already fetched are skipped, so an interrupted run can carry on.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/transit/wikidata.mjs <folder>');
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const query = (w, s, e, n) => `SELECT ?st ?stJa ?stEn ?coord ?line ?lineJa ?lineEn WHERE {
  SERVICE wikibase:box {
    ?st wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral .
  }
  ?st wdt:P31 ?kind .
  # Any kind of railway station or tram stop: Japanese items are filed under
  # dozens (metro, monorail, underground, elevated, interchange, airport…).
  { SELECT DISTINCT ?kind WHERE { { ?kind wdt:P279* wd:Q55488 } UNION { ?kind wdt:P279* wd:Q2175765 } } }
  OPTIONAL { ?st rdfs:label ?stJa FILTER(lang(?stJa) = "ja") }
  OPTIONAL { ?st rdfs:label ?stEn FILTER(lang(?stEn) = "en") }
  OPTIONAL {
    ?st wdt:P81 ?line .
    OPTIONAL { ?line rdfs:label ?lineJa FILTER(lang(?lineJa) = "ja") }
    OPTIONAL { ?line rdfs:label ?lineEn FILTER(lang(?lineEn) = "en") }
  }
}`;

const network = JSON.parse(readFileSync(new URL('../../data/transit/japan-rail.json', import.meta.url), 'utf8'));
const squares = [...new Set(network.hubs.map(([, , lat, lng]) => `${Math.floor(lng)},${Math.floor(lat)}`))]
  .map((k) => k.split(',').map(Number));

for (const [w, s] of squares) {
  const file = join(dir, `box_${w}_${s}.json`);
  const good = () => { try { JSON.parse(readFileSync(file, 'utf8')); return true; } catch { return false; } };
  if (existsSync(file) && good()) continue;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const body = execFileSync('curl', [
      '-sS', '--max-time', '120',
      '-H', 'Accept: application/sparql-results+json',
      '-H', 'User-Agent: WanderTransitBuild/1.0 (https://github.com/grenn24/wander)',
      '--data-urlencode', `query=${query(w, s, w + 1, s + 1)}`,
      'https://query.wikidata.org/sparql',
    ], { encoding: 'utf8', maxBuffer: 1 << 28 });
    writeFileSync(file, body);
    if (good()) break;
  }
  console.log(`${w},${s}: ${good() ? 'ok' : 'failed'}`);
}
