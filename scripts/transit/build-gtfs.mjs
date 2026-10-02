/*
 * An open GTFS timetable, packed for the transit planner — the same format
 * as greater Tokyo's (lib/timetable), so any city whose operator publishes
 * its timetable can be planned from real departures.
 *
 * Japan's open feeds are listed in the GTFS Data Repository
 * (https://gtfs-data.jp/); most are buses, a few are railways and trams. Each
 * one used is named in REGIONS below, with where it comes from and its
 * licence, and lib/timetableRegions.js says where it applies.
 *
 *   unzip feed.zip -d feed            (or a folder of the .txt files)
 *   node scripts/transit/build-gtfs.mjs fukuoka feed
 *
 * The two days kept are the timetables running on a Wednesday and a Sunday
 * shortly after the build, so rebuild after each timetable change.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FORMAT, packTiming, packTrain } from '../../lib/timetable.js';

/*
 * The feeds, by region. `licence` is shown in data/transit/LICENSE-<id>;
 * `source` is where to download the feed again.
 */
const REGIONS = {
  fukuoka: {
    name: 'Fukuoka City Subway',
    source: 'https://github.com/kuwayamamasayuki/GTFS-FukuokaCitySubway (dist/)',
    licence: 'CC BY 4.0. Timetables: Fukuoka City Transportation Bureau. GTFS: Masayuki Kuwayama.',
  },
};

const [id, ...feeds] = process.argv.slice(2);
if (!REGIONS[id] || !feeds.length || !feeds.every((f) => existsSync(join(f, 'stop_times.txt')))) {
  console.error(`Usage: node scripts/transit/build-gtfs.mjs <${Object.keys(REGIONS).join('|')}> <GTFS folder>...`);
  process.exit(1);
}
const region = REGIONS[id];
const out = new URL('../../data/transit/', import.meta.url);

/* ---------------------------------------------------------------- CSV -- */

/** A GTFS file as objects, by header. Quoted fields, commas and newlines in quotes, and a BOM are allowed. */
function table(dir, name) {
  const file = join(dir, `${name}.txt`);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
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

for (const dir of feeds) {
  const english = new Map();
  table(dir, 'translations').forEach((t) => {
    if (t.language === 'en' && t.field_value) english.set(`${t.table_name}|${t.field_value}`, t.translation);
  });

  // Each line, named in English where the feed says how.
  const routeIndex = new Map();
  table(dir, 'routes').forEach((r) => {
    const ja = r.route_short_name || r.route_long_name;
    const en = english.get(`routes|${ja}`) || '';
    routeIndex.set(r.route_id, lines.length);
    lines.push([en || ja, (r.route_color || '').toUpperCase(), VEHICLE[r.route_type] || 'RAIL']);
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
    const key = `${dir}|${station.stop_id}|${route}`;
    if (!stopIndex.has(key)) {
      if (!groupOf.has(station.stop_id)) groupOf.set(station.stop_id, groups++);
      const group = groupOf.get(station.stop_id);
      const at = rawStops.get(sid);
      stopIndex.set(key, stops.length);
      stops.push([
        english.get(`stops|${station.stop_name}`) || station.stop_name,
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
      if (st.length < 2 || route == null) { skipped.broken += 1; return; }
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
  source: { name: region.name, url: region.source, built: new Date().toISOString().slice(0, 10), licence: region.licence },
  lines,
  types: [''],
  stops,
  seqs,
  timings,
  days: packed,
};

mkdirSync(out, { recursive: true });
writeFileSync(new URL(`${id}-rail.json`, out), JSON.stringify(data));
writeFileSync(new URL(`LICENSE-${id}`, out), `${id}-rail.json is packed from the ${region.name} GTFS feed:\n${region.source}\n\n${region.licence}\n`);
const throughs = Object.values(packed).reduce((n, d) => n + d.through.length / 2, 0);
console.log(`${region.name}: ${stops.length} stops on ${lines.length} lines; ${days.weekday.length} weekday and `
  + `${days.weekend.length} weekend trains, ${throughs} running on; ${(JSON.stringify(data).length / 1e3).toFixed(0)} KB.`);
if (skipped.broken) console.log(`Left out ${skipped.broken} trips with unreadable times.`);
