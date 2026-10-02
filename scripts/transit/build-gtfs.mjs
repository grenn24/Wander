/*
 * Japan's open railway timetables outside greater Tokyo, packed for the
 * transit planner in the same format as Tokyo's (lib/timetable), so these
 * lines are planned from their real departures.
 *
 * The feeds are the railways and trams in the GTFS Data Repository
 * (https://gtfs-data.jp/), found by reading every current feed's route types
 * (October 2026: 579 feeds, nearly all buses), and Fukuoka's subway, published
 * on GitHub. They all go into one file, data/transit/open-rail.json, and
 * data/transit/LICENSE-open names each with its publisher and licence, as
 * the repository records them.
 *
 *   node scripts/transit/build-gtfs.mjs <work folder>
 *
 * Feeds are downloaded into the work folder (curl, unzip, git) and kept
 * there; delete it to fetch them afresh. The days packed are those running on
 * a Wednesday and a Sunday soon after the build, so rebuild after each
 * timetable change. Where a feed has no English names, they are borrowed from
 * the station or line of the same name in data/transit/japan-rail.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { FORMAT, packTiming, packTrain, haversineKm } from '../../lib/timetable.js';

/*
 * The feeds. `repository` is the repository's organisation/feed id; `git` is
 * a repository and folder to clone instead. `en` names the operator in
 * English, for lines whose feed names them only generically. `vehicle`
 * corrects a feed that files its trams as buses.
 */
const FEEDS = [
  {
    id: 'fukuoka-subway', en: 'Fukuoka City Subway',
    git: 'https://github.com/kuwayamamasayuki/GTFS-FukuokaCitySubway.git', folder: 'dist',
    publisher: 'Fukuoka City Transportation Bureau; GTFS by Masayuki Kuwayama', licence: 'CC BY 4.0',
  },
  { id: 'kumamoto-tram', repository: 'kumamoto-shiden/kumamotoshiden', en: 'Kumamoto City Tram' },
  { id: 'kumamoto-dentetsu', repository: 'kumamotodentetsu/kumamotodentetsu', en: 'Kumamoto Electric Railway' },
  { id: 'kochi-tram', repository: 'tosaden-kotsu/GTFS-Tosadentraffic_Streetcar', en: 'Tosaden Kōtsū Tram' },
  { id: 'toyama-tram', repository: 'chitetsu/chitetsushinaidensha', en: 'Toyama City Tram', vehicle: 'TRAM' },
  { id: 'takaoka-tram', repository: 'manyosen/manyosen', en: 'Manyōsen' },
  { id: 'ise-railway', repository: 'isetetu/iserailway', en: 'Ise Railway' },
  { id: 'akechi-railway', repository: 'aketetsu/akechirailway', en: 'Akechi Railway' },
  { id: 'yamagata-railway', repository: 'yamagatatetsudo/flowerliner', en: 'Yamagata Railway' },
  { id: 'konan-railway', repository: 'hirosakicity/kounan-tetsudou', en: 'Kōnan Railway' },
];

// Trains needing a ticket beyond the fare, left out as in Tokyo: the Limited Express Nanki on the Ise Railway.
const SURCHARGE = /特急|ライナー|有料/;

const work = process.argv[2];
if (!work) {
  console.error('Usage: node scripts/transit/build-gtfs.mjs <work folder>');
  process.exit(1);
}
mkdirSync(work, { recursive: true });
const out = new URL('../../data/transit/', import.meta.url);
const curl = (...args) => execFileSync('curl', ['-sS', '-L', '--max-time', '180', '--retry', '3', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

/** Each feed's folder of .txt files, fetched if not already there, and who publishes it under what licence. */
function fetchFeed(feed) {
  const dir = join(work, feed.id);
  const meta = join(work, `${feed.id}.json`);
  if (!existsSync(join(dir, 'stop_times.txt'))) {
    if (feed.git) {
      execFileSync('git', ['clone', '--depth', '1', '-q', feed.git, join(work, `${feed.id}-git`)]);
      mkdirSync(dir, { recursive: true });
      const from = join(work, `${feed.id}-git`, feed.folder);
      readdirSync(from).filter((f) => f.endsWith('.txt')).forEach((f) => writeFileSync(join(dir, f), readFileSync(join(from, f))));
      writeFileSync(meta, JSON.stringify({ publisher: feed.publisher, licence: feed.licence, source: feed.git }));
    } else {
      const [org, id] = feed.repository.split('/');
      const body = JSON.parse(curl(`https://api.gtfs-data.jp/v2/organizations/${org}/feeds/${id}`)).body;
      const file = body.gtfs_files.find((f) => f.rid === 'current') || body.gtfs_files[0];
      const zip = join(work, `${feed.id}.zip`);
      curl('-o', zip, file.gtfs_url);
      mkdirSync(dir, { recursive: true });
      execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
      unlinkSync(zip);
      writeFileSync(meta, JSON.stringify({
        publisher: body.organization_name, licence: body.feed_license,
        source: `https://api.gtfs-data.jp/v2/organizations/${org}/feeds/${id}`, valid: `${file.from_date} to ${file.to_date}`,
      }));
    }
  }
  // Some feeds keep their files one folder down.
  const inner = readdirSync(dir).find((f) => existsSync(join(dir, f, 'stop_times.txt')));
  return { dir: inner ? join(dir, inner) : dir, ...JSON.parse(readFileSync(meta, 'utf8')) };
}

/* English names to borrow, from the nationwide network: stations and lines by Japanese name. */
const japan = JSON.parse(readFileSync(new URL('../../data/transit/japan-rail.json', import.meta.url), 'utf8'));
const strip = (s) => String(s || '').normalize('NFKC').replace(/[（(][^）)]*[）)]/g, '').replace(/(駅|停留場|停留所|電停)$/, '').trim();
function borrowStation(ja, at) {
  const near = japan.hubs
    .filter(([name, en, lat, lng]) => en && strip(name) === strip(ja) && haversineKm({ lat, lng }, at) < 1)
    .sort((a, b) => haversineKm({ lat: a[2], lng: a[3] }, at) - haversineKm({ lat: b[2], lng: b[3] }, at));
  return near.length ? near[0][1] : '';
}
function borrowLine(ja, at) {
  const near = japan.lines.filter((l) => l.en && l.k !== 'shinkansen' && strip(l.ja) === strip(ja)
    && l.s.some((h) => haversineKm({ lat: japan.hubs[h][2], lng: japan.hubs[h][3] }, at) < 5));
  return near.length ? near[0].en : '';
}

/* ---------------------------------------------------------------- CSV -- */

/** A GTFS file as objects, by header. Quoted fields, commas and newlines in quotes, and a BOM are allowed. */
function table(dir, name) {
  const file = join(dir, `${name}.txt`);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/* --------------------------------------------------------------- days -- */

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
/** The services running on a date, from calendar.txt and its exceptions. */
function running(calendar, exceptions, date) {
  const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getUTCDay()];
  const on = new Set(calendar
    .filter((c) => c[day] === '1' && c.start_date <= ymd(date) && ymd(date) <= c.end_date)
    .map((c) => c.service_id));
  exceptions.filter((e) => e.date === ymd(date)).forEach((e) => {
    if (e.exception_type === '1') on.add(e.service_id);
    if (e.exception_type === '2') on.delete(e.service_id);
  });
  return on;
}
/** The first such weekday from today on with any service at all. */
function serviceOn(calendar, exceptions, weekday) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  for (let week = 0; week < 12; week += 1) {
    const on = running(calendar, exceptions, d);
    if (on.size) return on;
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return new Set();
}

/* ------------------------------------------------------------- build -- */

// GTFS route types to what Google calls the vehicle.
const VEHICLE = { 0: 'TRAM', 1: 'SUBWAY', 2: 'RAIL', 5: 'CABLE_CAR', 7: 'FUNICULAR', 12: 'MONORAIL' };
const minutes = (hms) => {
  const [h, m, s] = hms.split(':').map(Number);
  return Math.round(h * 60 + m + (s || 0) / 60);
};

const lines = [];
const stops = [];
const stopIndex = new Map();
const seqs = [];
const seqIndex = new Map();
const timings = [];
const timingIndex = new Map();
const intern = (list, index, key, value) => {
  if (!index.has(key)) { index.set(key, list.length); list.push(value); }
  return index.get(key);
};
const days = { weekday: [], weekend: [] };
const skipped = { broken: 0 };
let groups = 0;

const sources = [];
for (const feed of FEEDS) {
  const { dir, ...about } = fetchFeed(feed);
  sources.push({ ...feed, ...about });
  const english = new Map();
  table(dir, 'translations').forEach((t) => {
    if (t.language === 'en' && t.field_value) english.set(`${t.table_name}|${t.field_value}`, t.translation);
  });

  // Each line, named in English where the feed says how, or the network does, or else after its operator.
  const rawStopsEarly = new Map(table(dir, 'stops').map((s) => [s.stop_id, s]));
  const firstStop = new Map();
  table(dir, 'stop_times').forEach((st) => { if (!firstStop.has(st.trip_id)) firstStop.set(st.trip_id, st.stop_id); });
  const routeAt = new Map();
  table(dir, 'trips').forEach((t) => {
    const stop = rawStopsEarly.get(firstStop.get(t.trip_id));
    if (stop && !routeAt.has(t.route_id)) routeAt.set(t.route_id, { lat: Number(stop.stop_lat), lng: Number(stop.stop_lon) });
  });
  const routeIndex = new Map();
  table(dir, 'routes').forEach((r) => {
    const ja = strip(r.route_short_name || r.route_long_name);
    if (SURCHARGE.test(`${r.route_short_name} ${r.route_long_name}`)) return;
    const at = routeAt.get(r.route_id);
    let en = english.get(`routes|${r.route_short_name}`) || english.get(`routes|${r.route_long_name}`)
      || (at && borrowLine(ja, at)) || feed.en;
    // A line named for where it goes ("To Naka Shinminato") or by a letter ("A route") is named for its operator.
    const letter = en.match(/^([A-Z0-9]{1,2})\s*(route|line)$/i);
    if (letter) en = `${feed.en} ${letter[1]}`;
    else if (/^To\s|streetcar/i.test(en)) en = feed.en;
    routeIndex.set(r.route_id, lines.length);
    lines.push([en, (r.route_color || '').toUpperCase(), feed.vehicle || VEHICLE[r.route_type] || 'RAIL']);
  });

  // Platforms belong to their station; one station is one place to change.
  const rawStops = new Map(table(dir, 'stops').map((s) => [s.stop_id, s]));
  const stationOf = (sid) => {
    const s = rawStops.get(sid);
    return s && s.parent_station && rawStops.has(s.parent_station) ? rawStops.get(s.parent_station) : s;
  };
  const groupOf = new Map();
  const stopFor = (sid, route) => {
    const station = stationOf(sid);
    const key = `${feed.id}|${station.stop_id}|${route}`;
    if (!stopIndex.has(key)) {
      if (!groupOf.has(station.stop_id)) groupOf.set(station.stop_id, groups++);
      const group = groupOf.get(station.stop_id);
      const at = rawStops.get(sid);
      stopIndex.set(key, stops.length);
      const where = { lat: Number(at.stop_lat), lng: Number(at.stop_lon) };
      stops.push([
        english.get(`stops|${station.stop_name}`) || borrowStation(station.stop_name, where) || station.stop_name,
        Math.round(Number(at.stop_lat) * 1e5) / 1e5,
        Math.round(Number(at.stop_lon) * 1e5) / 1e5,
        route, group, group,
      ]);
    }
    return stopIndex.get(key);
  };

  const calendar = table(dir, 'calendar');
  const exceptions = table(dir, 'calendar_dates');
  const services = { weekday: serviceOn(calendar, exceptions, 3), weekend: serviceOn(calendar, exceptions, 0) };

  const timesOf = new Map();
  table(dir, 'stop_times').forEach((st) => {
    if (!timesOf.has(st.trip_id)) timesOf.set(st.trip_id, []);
    timesOf.get(st.trip_id).push(st);
  });

  const trips = table(dir, 'trips');
  for (const [day, on] of Object.entries(services)) {
    const blocks = new Map();
    trips.filter((t) => on.has(t.service_id)).forEach((t) => {
      const route = routeIndex.get(t.route_id);
      const st = (timesOf.get(t.trip_id) || []).sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
      if (route == null) return; // a surcharge train
      if (st.length < 2) { skipped.broken += 1; return; }
      const seen = st.map((s) => {
        const a = minutes(s.arrival_time || s.departure_time);
        const d = minutes(s.departure_time || s.arrival_time);
        return [a, Math.max(a, d)];
      });
      const values = [];
      for (let k = 1; k < seen.length; k += 1) values.push(seen[k][0] - seen[k - 1][1], seen[k][1] - seen[k][0]);
      if (values.some((v) => v < 0 || v > 600)) { skipped.broken += 1; return; }
      const sequence = st.map((s) => stopFor(s.stop_id, route));
      const train = {
        seq: intern(seqs, seqIndex, sequence.join('.'), sequence),
        timing: intern(timings, timingIndex, values.join('.'), packTiming(values)),
        start: seen[0][1],
        type: 0,
        first: stationOf(st[0].stop_id).stop_id,
        last: stationOf(st[st.length - 1].stop_id).stop_id,
        end: seen[seen.length - 1][0],
        index: days[day].length,
      };
      days[day].push(train);
      if (t.block_id) {
        if (!blocks.has(t.block_id)) blocks.set(t.block_id, []);
        blocks.get(t.block_id).push(train);
      }
    });

    /*
     * A block is one vehicle's day. Where its next trip leaves from the
     * station the last one ended at, within a few minutes, the train runs
     * on and the passenger stays on board — Fukuoka's Kūkō Line into the
     * Hakozaki Line at Nakasu-Kawabata.
     */
    for (const block of blocks.values()) {
      block.sort((a, b) => a.start - b.start);
      for (let k = 1; k < block.length; k += 1) {
        const a = block[k - 1];
        const b = block[k];
        if (a.last === b.first && b.start >= a.end && b.start - a.end <= 5) (a.next ||= []).push(b.index);
      }
    }
  }
}

const packed = {};
for (const [day, trains] of Object.entries(days)) {
  const through = [];
  trains.forEach((t, i) => (t.next || []).forEach((j) => through.push(i, j)));
  packed[day] = { trains: trains.map(packTrain).join(''), through };
}

const data = {
  format: FORMAT,
  source: {
    name: 'Open GTFS feeds',
    url: 'https://gtfs-data.jp/',
    built: new Date().toISOString().slice(0, 10),
    licence: 'Each feed\'s own; see LICENSE-open',
  },
  lines,
  types: [''],
  stops,
  seqs,
  timings,
  days: packed,
};

mkdirSync(out, { recursive: true });
writeFileSync(new URL('open-rail.json', out), JSON.stringify(data));
writeFileSync(new URL('LICENSE-open', out), `open-rail.json is packed from these open GTFS feeds, each under its own licence.
Changed: trains needing a surcharge are left out, two days of service are kept, and
English names missing from a feed are taken from japan-rail.json (see LICENSE-japan).

${sources.map((f) => `${f.en} — ${f.publisher}\n  Licence: ${f.licence}\n  Source: ${f.source}`).join('\n\n')}
`);
const throughs = Object.values(packed).reduce((n, d) => n + d.through.length / 2, 0);
console.log(`${sources.length} feeds: ${stops.length} stops on ${lines.length} lines; ${days.weekday.length} weekday and `
  + `${days.weekend.length} weekend trains, ${throughs} running on; ${(JSON.stringify(data).length / 1e3).toFixed(0)} KB.`);
if (skipped.broken) console.log(`Left out ${skipped.broken} trips with unreadable times.`);
