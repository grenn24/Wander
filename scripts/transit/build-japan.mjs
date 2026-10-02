/*
 * Every railway in Japan, as a network the planner can estimate journeys on
 * where there is no open timetable.
 *
 * Outside greater Tokyo no operator publishes its timetable openly, so the
 * nationwide answer is a model: real lines, real stations and real track,
 * with travelling times worked out from distance and waiting times from how
 * often trains run. The source is the 全国鉄道運行本数データ of the
 * University of Tokyo and the Japan Bus Information Association
 * (https://gtfs-gis.jp/railway_honsu/, CC BY 4.0 / ODbL): every line in the
 * government's railway register — JR, private, subway, monorail and tram —
 * as sections of track with the number of trains each way on a weekday, and
 * each line's stations in order.
 *
 * It counts only trains that need no ticket beyond the fare, so it has no
 * Shinkansen; scripts/transit/shinkansen.mjs supplies those.
 *
 *   curl -O https://gtfs-gis.jp/railway_honsu/data/unkohonsu2026_rosen_kukan.geojson
 *   curl -O https://gtfs-gis.jp/railway_honsu/data/unkohonsu2026_rosen_eki.geojson
 *   node scripts/transit/build-japan.mjs <that folder> [mini-tokyo-3d checkout]
 *
 * The mini-tokyo-3d checkout, the one build-tokyo.mjs reads, is optional: it
 * gives English names to the lines and stations of greater Tokyo.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { encodePath, haversineKm } from '../../lib/timetable.js';
import { MODEL_FORMAT } from '../../lib/railModel.js';
import { lineName } from './names.mjs';
import { SHINKANSEN } from './shinkansen.mjs';

const [dir, tokyo] = process.argv.slice(2);
const latest = (kind) => {
  const files = existsSync(dir || '') ? readdirSync(dir).filter((f) => new RegExp(`^unkohonsu(\\d{4})_${kind}\\.geojson$`).test(f)).sort() : [];
  return files.length ? join(dir, files[files.length - 1]) : null;
};
const sectionsFile = latest('rosen_kukan');
const stationsFile = latest('rosen_eki');
if (!sectionsFile || !stationsFile) {
  console.error('Usage: node scripts/transit/build-japan.mjs <folder with unkohonsu*_rosen_kukan.geojson and _rosen_eki.geojson> [mini-tokyo-3d]');
  process.exit(1);
}
const year = sectionsFile.match(/unkohonsu(\d{4})/)[1];
const features = (file) => JSON.parse(readFileSync(file, 'utf8')).features;
const out = new URL('../../data/transit/', import.meta.url);

/* ------------------------------------------------------------- kinds -- */

/*
 * What kind of railway a line is decides how fast its trains go between
 * stations (lib/railModel). The register's operator codes group them: 1xx JR,
 * 2xx the big private railways and the city subways, 3xx–4xx the smaller
 * railways, 5xx monorails, guideways and trams. A few operators run more than
 * one kind, and are sorted out by line.
 */
const SUBWAYS = new Set([201, 215, 220, 222, 224, 230, 231, 232, 237, 501]);
const TRAMS = new Set([351, 551, 552, 553, 554, 555, 556, 557, 558, 559, 560]);
function kindOf(op, line) {
  if (/新幹線/.test(line)) return 'shinkansen';
  if (op === 218) return line === '荒川線' ? 'tram' : line === '日暮里・舎人線' ? 'monorail' : 'subway';
  if (op === 230 && /南港ポートタウン/.test(line)) return 'monorail';
  if (op === 211 && line === '世田谷線') return 'tram';
  if (op === 354 && /市内線|環状線|富山港線/.test(line)) return 'tram';
  if (op === 373 && /東田本線/.test(line)) return 'tram';
  if (op === 436 && /号線/.test(line)) return 'tram';
  if (op === 453 && /系統/.test(line)) return 'tram';
  if (SUBWAYS.has(op)) return 'subway';
  if (TRAMS.has(op)) return 'tram';
  if (op >= 502 && op <= 518) return 'monorail';
  return 'rail';
}

/* ------------------------------------------------------------ English -- */

// mini-tokyo-3d's operators, by the register's names for them.
const TOKYO_OPERATORS = {
  JR東日本: 'JR-East', JR東海: 'JR-Central', 東京地下鉄: 'TokyoMetro', 東京都: 'Toei', 東急電鉄: 'Tokyu',
  小田急電鉄: 'Odakyu', 京王電鉄: 'Keio', 西武鉄道: 'Seibu', 東武鉄道: 'Tobu', 京成電鉄: 'Keisei',
  京浜急行電鉄: 'Keikyu', 相模鉄道: 'Sotetsu', 横浜市: 'YokohamaMunicipal', 東京臨海高速鉄道: 'TWR',
  首都圏新都市鉄道: 'MIR', ゆりかもめ: 'Yurikamome', 東京モノレール: 'TokyoMonorail',
  多摩都市モノレール: 'TamaMonorail', 埼玉高速鉄道: 'SaitamaRailway', 東葉高速鉄道: 'ToyoRapid',
  北総鉄道: 'Hokuso', 芝山鉄道: 'Shibayama', 横浜高速鉄道: 'Minatomirai', 千葉都市モノレール: 'ChibaMonorail',
  湘南モノレール: 'ShonanMonorail', 横浜シーサイドライン: 'YokohamaSeaside', 埼玉新都市交通: 'SaitamaTransit',
  山万: 'Yamaman', 江ノ島電鉄: 'Enoden', 小田急箱根: 'OdakyuHakone', 伊豆箱根鉄道: 'IzuHakone',
  伊豆急行: 'Izukyu', 富士急行: 'Fujikyu', 秩父鉄道: 'Chichibu', 関東鉄道: 'KantoRailway', 流鉄: 'Ryutetsu',
  小湊鐵道: 'Kominato', いすみ鉄道: 'Isumi', 銚子電気鉄道: 'Choshi', 鹿島臨海鉄道: 'KashimaRinkai',
  ひたちなか海浜鉄道: 'Hitachinaka', 真岡鐵道: 'Moka', 宇都宮ライトレール: 'UtsunomiyaLightRail',
  わたらせ渓谷鐵道: 'WataraseKeikoku', 上毛電気鉄道: 'Jomo', 上信電鉄: 'Joshin',
};
const fold = (s) => String(s || '').normalize('NFKC').replace(/ヶ/g, 'ケ').replace(/\s/g, '');

const english = { lines: new Map(), stations: new Map() };
if (tokyo) {
  const read = (name) => JSON.parse(readFileSync(join(tokyo, 'data', name), 'utf8'));
  read('railways.json').forEach((r) => {
    english.lines.set(`${r.id.split('.')[0]}|${fold(r.title.ja)}`, lineName(r));
  });
  read('stations.json').forEach((s) => {
    if (!s.coord) return;
    const key = fold(s.title.ja);
    if (!english.stations.has(key)) english.stations.set(key, []);
    english.stations.get(key).push({ lat: s.coord[1], lng: s.coord[0], en: s.title.en });
  });
}
function stationEnglish(name, point) {
  const near = (english.stations.get(fold(name)) || [])
    .filter((s) => haversineKm(s, point) < 1.5)
    .sort((a, b) => haversineKm(a, point) - haversineKm(b, point));
  return near.length ? near[0].en : '';
}

/* ------------------------------------------------------------ geometry -- */

const toPoint = ([lng, lat]) => ({ lat, lng });
const metres = (a, b) => haversineKm(a, b) * 1000;

/** Where along a line a point falls: its distance from the start, and how far off the line it is, in metres. */
function chainage(points, along, p) {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    // Flat enough over one segment: x east, y north, in metres.
    const kx = 111320 * Math.cos(a.lat * Math.PI / 180);
    const ky = 110540;
    const bx = (b.lng - a.lng) * kx;
    const by = (b.lat - a.lat) * ky;
    const px = (p.lng - a.lng) * kx;
    const py = (p.lat - a.lat) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < best) { best = d; at = along[i] + t * (along[i + 1] - along[i]); }
  }
  return { at, off: best };
}

/** The piece of a line between two distances along it. */
function cut(points, along, from, to) {
  const at = (c) => {
    let i = 0;
    while (i < along.length - 2 && along[i + 1] < c) i += 1;
    const span = along[i + 1] - along[i];
    const t = span ? (c - along[i]) / span : 0;
    return { lat: points[i].lat + t * (points[i + 1].lat - points[i].lat), lng: points[i].lng + t * (points[i + 1].lng - points[i].lng) };
  };
  const inside = points.filter((_, i) => along[i] > from && along[i] < to);
  return [at(from), ...inside, at(to)];
}

/** Fewer points, none more than `tolerance` metres from where the line was (Douglas–Peucker). */
function simplify(points, tolerance = 20) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let far = 0;
    let index = -1;
    for (let i = s + 1; i < e; i += 1) {
      const { off } = chainage([points[s], points[e]], [0, 1], points[i]);
      if (off > far) { far = off; index = i; }
    }
    if (far > tolerance && index > 0) { keep[index] = 1; stack.push([s, index], [index, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

/* ----------------------------------------------------------- stations -- */

/*
 * One interchange for every station of one name within 600 m, across lines
 * and companies: 京都 is one place to change, whether the JR lines' or the
 * subway's. Stations of different names that happen to be close (梅田 and
 * 大阪) are joined by walking, at run time, not here.
 */
const hubs = [];
const hubsByName = new Map();
function hubOf(name, point) {
  const key = fold(name);
  const same = (hubsByName.get(key) || []).find((h) => metres(h.at, point) < 600);
  if (same) {
    same.points.push(point);
    return same.index;
  }
  const hub = { index: hubs.length, name, at: point, points: [point] };
  hubs.push(hub);
  if (!hubsByName.has(key)) hubsByName.set(key, []);
  hubsByName.get(key).push(hub);
  return hub.index;
}

/* -------------------------------------------------------------- lines -- */

const sections = features(sectionsFile);
const stations = features(stationsFile);
const lineKey = (p) => `${p['事業者コード']}:${p['路線コード']}`;
const byLine = new Map();
sections.forEach((f) => {
  const k = lineKey(f.properties);
  if (!byLine.has(k)) byLine.set(k, { sections: [], stations: [] });
  byLine.get(k).sections.push(f);
});
stations.forEach((f) => {
  const k = lineKey(f.properties);
  if (byLine.has(k)) byLine.get(k).stations.push(f);
});

const operators = [];
const operatorIndex = new Map();
const lines = [];
const problems = [];
let rerouted = 0;

for (const { sections: secs, stations: sts } of byLine.values()) {
  secs.sort((a, b) => a.properties['区間コード'] - b.properties['区間コード']);
  sts.sort((a, b) => a.properties['駅コード'] - b.properties['駅コード']);
  const first = secs[0].properties;
  if (sts.length < 2) { problems.push(`${first['事業者名']} ${first['路線名']}: no stations listed`); continue; }
  const op = first['事業者名'];
  if (!operatorIndex.has(op)) { operatorIndex.set(op, operators.length); operators.push(op); }
  const name = first['路線名'];
  const kind = kindOf(first['事業者コード'], name);
  const names = sts.map((s) => s.properties['駅名']);
  const points = sts.map((s) => toPoint(s.geometry.coordinates));
  const line = {
    o: operatorIndex.get(op),
    ja: name,
    en: english.lines.get(`${TOKYO_OPERATORS[op] || '-'}|${fold(name)}`) || '',
    k: kind,
    loop: names.length > 2 && names[0] === names[names.length - 1] ? 1 : 0,
    s: sts.map((s, i) => hubOf(names[i], points[i])),
    m: [], f: [], r: [], g: [],
    sf: [], sr: [],
  };

  /*
   * How many trains stop at each station, each way — fewer than pass it,
   * where expresses run. The register gives each station's two directions
   * as 向き1 and 向き2; the one in which the first station has no arrivals
   * runs along the station order.
   */
  const p0 = sts[0].properties;
  const forward = p0['着数1'] === 0 || p0['着数2'] !== 0 ? 1 : 2;
  const backward = forward === 1 ? 2 : 1;
  sts.forEach((st) => {
    const q = st.properties;
    line.sf.push(Math.max(q[`着数${forward}`] || 0, q[`発数${forward}`] || 0));
    line.sr.push(Math.max(q[`着数${backward}`] || 0, q[`発数${backward}`] || 0));
  });
  const hops = new Map(); // station index -> hop, for the stations a section joins

  let pointer = 0;
  for (const sec of secs) {
    const p = sec.properties;
    const i = names.indexOf(p['起点駅'], pointer);
    const j = i < 0 ? -1 : names.indexOf(p['終点駅'], i + 1);
    if (i < 0 || j < 0) { problems.push(`${op} ${name}: ${p['起点駅']}–${p['終点駅']} not among its stations`); continue; }
    pointer = j;

    // The track, running from the section's first station to its last.
    let track = sec.geometry.coordinates.map(toPoint);
    if (metres(track[0], points[i]) > metres(track[track.length - 1], points[i])) track = track.reverse();
    const along = [0];
    for (let k = 1; k < track.length; k += 1) along.push(along[k - 1] + metres(track[k - 1], track[k]));

    // Each station's distance along the track; one the track passes far from has none.
    const at = [];
    for (let k = i; k <= j; k += 1) {
      const c = chainage(track, along, points[k]);
      at.push(c.off < 400 ? c.at : null);
    }
    for (let k = i; k < j; k += 1) {
      const a = at[k - i];
      const b = at[k - i + 1];
      const straight = metres(points[k], points[k + 1]);
      let shape;
      let length;
      if (a != null && b != null && b - a >= straight * 0.9 && b - a <= Math.max(straight * 3, straight + 500)) {
        shape = cut(track, along, a, b);
        length = b - a;
      } else {
        // The track does not pass the station where the register puts it: a straight line, a little longer.
        shape = [points[k], points[k + 1]];
        length = straight * 1.1;
        rerouted += 1;
      }
      hops.set(k, {
        m: Math.round(length),
        f: p['順方向運行本数2024'] ?? p[`順方向運行本数${year}`] ?? 0,
        r: p['逆方向運行本数2024'] ?? p[`逆方向運行本数${year}`] ?? 0,
        g: encodePath(simplify(shape).map((q) => ({ lat: Math.round(q.lat * 1e5) / 1e5, lng: Math.round(q.lng * 1e5) / 1e5 }))),
      });
    }
  }
  // Hops in station order; a gap (a section closed for good) has no trains either way.
  for (let k = 0; k < sts.length - 1; k += 1) {
    const h = hops.get(k) || { m: Math.round(metres(points[k], points[k + 1])), f: 0, r: 0, g: '' };
    line.m.push(h.m); line.f.push(h.f); line.r.push(h.r); line.g.push(h.g);
  }
  lines.push(line);
}

/* --------------------------------------------------------- shinkansen -- */

/*
 * The Shinkansen, from scripts/transit/shinkansen.mjs: each station on the
 * interchange of the same name, or on its own where nothing else stops.
 */
for (const s of SHINKANSEN) {
  if (!operatorIndex.has(s.operator)) { operatorIndex.set(s.operator, operators.length); operators.push(s.operator); }
  /*
   * A name is not a place: there is an 大宮 in Kyoto as well as Saitama, and
   * a 福島 in Osaka. Each station takes the namesake nearest where it is said
   * to be or, failing that, nearest the station before it on the line.
   */
  const at = [];
  s.stations.forEach((st, i) => {
    const near = st.lat != null ? st : at[i - 1] ? hubs[at[i - 1]].at : null;
    const named = (hubsByName.get(fold(st.ja)) || [])
      .map((h) => ({ h, d: near ? metres(h.at, near) : 0 }))
      .sort((x, y) => x.d - y.d);
    if (named.length && (st.lat == null || named[0].d < 2000)) at.push(named[0].h.index);
    else if (st.lat != null) at.push(hubOf(st.ja, { lat: st.lat, lng: st.lng }));
    else throw new Error(`${s.ja} ${st.ja}: no station of that name to stand on, and no position given`);
    // No Shinkansen covers more than 300 km in an hour: further than that, a namesake is wrong.
    if (i && metres(hubs[at[i]].at, hubs[at[i - 1]].at) > (st.t - s.stations[i - 1].t) * 5000 + 20000) {
      throw new Error(`${s.ja}: ${s.stations[i - 1].ja} to ${st.ja} is ${Math.round(metres(hubs[at[i]].at, hubs[at[i - 1]].at) / 1000)} km, so one of them is the wrong namesake`);
    }
    if (st.en && !hubs[at[i]].en) hubs[at[i]].en = st.en;
  });
  lines.push({
    o: operatorIndex.get(s.operator),
    ja: s.ja,
    en: s.en,
    k: 'shinkansen',
    s: at,
    parts: s.parts || null,
    t: s.stations.map((st) => st.t),
    tier: s.stations.map((st) => st.tier),
    ph: s.stations.map((st) => st.ph),
  });
}

/* --------------------------------------------------------------- write -- */

const data = {
  format: MODEL_FORMAT,
  source: {
    name: '全国鉄道運行本数データ',
    url: 'https://gtfs-gis.jp/railway_honsu/',
    edition: year,
    built: new Date().toISOString().slice(0, 10),
    licence: 'CC BY 4.0 / ODbL; University of Tokyo Social ICT Research Center and Japan Bus Information Association; see LICENSE-japan',
  },
  operators,
  hubs: hubs.map((h) => {
    const lat = h.points.reduce((s, p) => s + p.lat, 0) / h.points.length;
    const lng = h.points.reduce((s, p) => s + p.lng, 0) / h.points.length;
    const at = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
    return [h.name, h.en || stationEnglish(h.name, at), at.lat, at.lng];
  }),
  lines,
};

mkdirSync(out, { recursive: true });
writeFileSync(new URL('japan-rail.json', out), JSON.stringify(data));
writeFileSync(new URL('LICENSE-japan', out), `japan-rail.json is derived from 全国鉄道運行本数データ ${year}年版
(https://gtfs-gis.jp/railway_honsu/), made by the Social ICT Research Center of the
University of Tokyo's Graduate School of Information Science and Technology and the
Regional Transport Data Laboratory of the Japan Bus Information Association, and
published under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) and ODbL
(https://opendatacommons.org/licenses/odbl/1-0/).

It was changed: stations of one name are joined into interchanges, each section of
track is cut at its stations and simplified, and Shinkansen lines from published
journey times (scripts/transit/shinkansen.mjs) are added. English names in greater
Tokyo come from mini-tokyo-3d (see LICENSE).

As the source allows, this derived database is offered under the ODbL too: it is
the file beside this one, built by scripts/transit/build-japan.mjs.
`);

const named = data.hubs.filter((h) => h[1]).length;
console.log(`${data.hubs.length} stations (${named} with English names) on ${lines.length} lines `
  + `(${lines.filter((l) => l.k === 'shinkansen').length} Shinkansen), ${operators.length} companies; `
  + `${(JSON.stringify(data).length / 1e6).toFixed(2)} MB.`);
console.log(`${rerouted} hops drawn straight where the track missed a station.`);
if (problems.length) console.log(`Skipped:\n  ${problems.join('\n  ')}`);
