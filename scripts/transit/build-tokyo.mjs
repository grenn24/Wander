/*
 * Greater Tokyo's train timetables, packed for the transit planner.
 *
 * Google's Routes API has no transit in Japan. The timetables are public all
 * the same — the operators publish them through the Public Transportation Open
 * Data Center — and the mini-tokyo-3d project (MIT licence) keeps every urban
 * railway in greater Tokyo in one set of files, updated as the timetables
 * change: JR East, Tokyo Metro, Toei, the private railways, the monorails and
 * the trams, out to Nikko, Hakone and Kawaguchiko. Not the Shinkansen.
 *
 * Its 110 MB of JSON become one file of about 2.5 MB: the stations, the lines,
 * and each weekday and weekend train as a stop sequence, a run of times and a
 * departure, with the trains it runs through into. lib/timetable.js reads it.
 *
 * Run it again when the timetables change — a revision every March, and
 * smaller ones through the year:
 *
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/nagix/mini-tokyo-3d.git
 *   git -C mini-tokyo-3d sparse-checkout set data
 *   node scripts/transit/build-tokyo.mjs mini-tokyo-3d
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { FORMAT, packTiming, packTrain } from '../../lib/timetable.js';
import { lineName, vehicle } from './names.mjs';

const repo = process.argv[2];
if (!repo || !existsSync(join(repo, 'data', 'railways.json'))) {
  console.error('Usage: node scripts/transit/build-tokyo.mjs <mini-tokyo-3d checkout>');
  process.exit(1);
}
const read = (name) => JSON.parse(readFileSync(join(repo, 'data', name), 'utf8'));
const out = new URL('../../data/transit/', import.meta.url);

/*
 * Trains that need a ticket on top of the fare — reserved seats and liners:
 * the Narita Express, the Romancecar, the Skyliner. Left out, because a plan
 * that says 41 minutes to Narita should not quietly assume a ¥2,580 seat that
 * may be sold out; the ordinary train is always there. Note that a "Limited
 * Express" on Keio, Keikyu, Keisei, Tokyu or Sotetsu is an ordinary train.
 */
const SURCHARGE = new Set([
  'JR-East.LimitedExpress', 'JR-Central.LimitedExpress',
  'TokyoMetro.LimitedExpress', 'TokyoMetro.S-TRAIN', 'TokyoMetro.TH-LINER',
  'Keio.KeioLiner', 'Keikyu.MorningWing', 'Keikyu.EveningWing',
  'Keisei.Skyliner', 'Keisei.Morningliner', 'Keisei.Eveningliner',
  'Seibu.LimitedExpress', 'Seibu.S-TRAIN', 'Seibu.HaijimaLiner',
  'Odakyu.LimitedExpress', 'OdakyuHakone.LimitedExpress',
  'Tobu.LimitedExpress', 'Tobu.TJ-Liner', 'Tobu.TH-LINER', 'Tobu.SL-Taiju',
  'Tokyu.S-TRAIN', 'Minatomirai.S-TRAIN',
  'Fujikyu.LimitedExpress', 'IzuHakone.LimitedExpress', 'Izukyu.LimitedExpress',
  'Chichibu.Express', 'Chichibu.PaleoExpress',
]);

/*
 * The weekend timetable is Saturdays, Sundays and holidays. A few small
 * operators keep separate Saturday and holiday timetables; their holiday one
 * stands for both, being the thinner of the two.
 */
const DAYS = { Weekday: 'weekday', SaturdayHoliday: 'weekend', Holiday: 'weekend' };

// "Toei.Oedo.1234.Weekday" or, for a train in parts, "JR-East.Chuo.3132M.Weekday.1".
function calendarOf(id) {
  const parts = id.split('.');
  return /^\d+$/.test(parts[parts.length - 1]) ? parts[parts.length - 2] : parts[parts.length - 1];
}

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/* ----------------------------------------------------------------------- */

const railways = read('railways.json');
const stations = read('stations.json');
const groups = read('station-groups.json');
const types = read('train-types.json');

const lines = railways.map((r) => [lineName(r), (r.color || '').replace('#', '').toUpperCase(), vehicle(r.id)]);
const lineIndex = new Map(railways.map((r, i) => [r.id, i]));

// Each station's interchange complex, and which part of it.
const groupOf = new Map();
let places = 0;
groups.forEach((group, g) => group.forEach((part) => {
  part.forEach((id) => groupOf.set(id, [g, places]));
  places += 1;
}));

const typeNames = [];
const typeIndex = new Map();
function typeOf(id) {
  if (!typeIndex.has(id)) {
    const t = types.find((x) => x.id === id);
    typeIndex.set(id, typeNames.length);
    typeNames.push(t ? t.title.en : '');
  }
  return typeIndex.get(id);
}

const stationById = new Map(stations.map((s) => [s.id, s]));
const stops = [];
const stopIndex = new Map();
function stopOf(id) {
  if (!stopIndex.has(id)) {
    const s = stationById.get(id);
    if (!s) throw new Error(`Unknown station ${id}`);
    const [group, place] = groupOf.get(id) || [-1, -1];
    const round = (v) => Math.round(v * 1e5) / 1e5;
    stopIndex.set(id, stops.length);
    stops.push([
      s.title.en,
      s.coord ? round(s.coord[1]) : null,
      s.coord ? round(s.coord[0]) : null,
      lineIndex.get(s.railway) ?? -1,
      group, place,
    ]);
  }
  return stopIndex.get(id);
}

const seqs = [];
const seqIndex = new Map();
const timings = [];
const timingIndex = new Map();
const intern = (list, index, key, value) => {
  if (!index.has(key)) { index.set(key, list.length); list.push(value); }
  return index.get(key);
};

const days = { weekday: [], weekend: [] };
const skipped = { surcharge: 0, other: 0, broken: 0 };

const files = readdirSync(join(repo, 'data', 'train-timetables')).filter((f) => f.endsWith('.json')).sort();
for (const file of files) {
  for (const train of read(join('train-timetables', file))) {
    const day = DAYS[calendarOf(train.id)];
    if (!day) { skipped.other += 1; continue; }
    if (SURCHARGE.has(train.y)) { skipped.surcharge += 1; continue; }
    if (!train.tt || train.tt.length < 2) { skipped.broken += 1; continue; }

    /*
     * Times are clock times, so a train that runs past midnight goes from
     * 23:58 to 00:02. Counted on from the first stop instead, and a train that
     * starts before three in the morning is the previous day's last.
     */
    const seen = [];
    let previous = null;
    let broken = false;
    train.tt.forEach((stop) => {
      let a = stop.a ? minutes(stop.a) : null;
      let d = stop.d ? minutes(stop.d) : null;
      if (a == null) a = d;
      if (d == null) d = a;
      if (previous == null && a < 180) { a += 1440; d += 1440; }
      while (previous != null && a < previous) a += 1440;
      while (d < a) d += 1440;
      if (previous != null && a - previous > 600) broken = true;
      seen.push([a, d]);
      previous = d;
    });
    if (broken) { skipped.broken += 1; continue; }

    const values = [];
    for (let k = 1; k < seen.length; k += 1) {
      values.push(seen[k][0] - seen[k - 1][1], seen[k][1] - seen[k][0]);
    }
    const sequence = train.tt.map((s) => stopOf(s.s));
    days[day].push({
      id: train.id,
      next: train.nt || [],
      seq: intern(seqs, seqIndex, sequence.join('.'), sequence),
      timing: intern(timings, timingIndex, values.join('.'), packTiming(values)),
      start: seen[0][1],
      type: typeOf(train.y),
    });
  }
}

const packed = {};
for (const [day, trains] of Object.entries(days)) {
  const at = new Map(trains.map((t, i) => [t.id, i]));
  const through = [];
  trains.forEach((t, i) => t.next.forEach((id) => { if (at.has(id)) through.push(i, at.get(id)); }));
  packed[day] = { trains: trains.map(packTrain).join(''), through };
}

let commit = '';
try { commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }

const data = {
  format: FORMAT,
  source: {
    name: 'mini-tokyo-3d',
    url: 'https://github.com/nagix/mini-tokyo-3d',
    commit,
    built: new Date().toISOString().slice(0, 10),
    licence: 'MIT, Copyright (c) 2019-2026 Akihiko Kusanagi; see LICENSE',
  },
  lines,
  types: typeNames,
  stops,
  seqs,
  timings,
  days: packed,
};

mkdirSync(out, { recursive: true });
writeFileSync(new URL('tokyo-rail.json', out), JSON.stringify(data));
const licence = readFileSync(join(repo, 'LICENSE'), 'utf8');
writeFileSync(new URL('LICENSE', out), 'The timetables in tokyo-rail.json are derived from mini-tokyo-3d\n'
  + '(https://github.com/nagix/mini-tokyo-3d), which is distributed under this licence.\n'
  + 'Its timetables come from the operators, through the Public Transportation Open Data Center.\n\n'
  + licence);

const size = JSON.stringify(data).length;
console.log(`${stops.length} stations on ${lines.length} lines; `
  + `${days.weekday.length} weekday and ${days.weekend.length} weekend trains `
  + `(${seqs.length} stop sequences, ${timings.length} runs of times); ${(size / 1e6).toFixed(2)} MB.`);
console.log(`Left out: ${skipped.surcharge} surcharge trains, ${skipped.other} on other timetables, ${skipped.broken} unreadable.`);
