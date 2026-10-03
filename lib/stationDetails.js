/*
 * Platforms and exits for train options (lib/trainOptions) from
 * OpenStreetMap's stations (scripts/transit/osm-stations.mjs), where the
 * timetable has not already said:
 *
 *   a ride's platform   the platform its line's route stops at where you
 *                       board, on a route that reaches where you get off
 *                       after it, so the direction is the right one
 *   the last walk's exit  the station entrance nearest where you are going,
 *                       within reach of the station you get off at
 *
 * Nothing found, nothing shown. Plain data in, plain data out, so it is
 * tested with node; lib/railTransit loads a country's file and calls it.
 */

import { decodePath, encodePath } from './polyline.js';
import { haversineKm } from './timetable.js';
import { plain } from './registry.js';

// How near a route's stop must be to a station to be that station's, and an entrance to be its exit.
const STOP_KM = 0.3;
const EXIT_KM = 0.35;
const CELL = 0.01;

const cellOf = (p) => `${Math.floor(p.lat / CELL)},${Math.floor(p.lng / CELL)}`;

/**
 * A country's stations file, indexed: exits by grid cell, routes by operator.
 */
export function indexStations(data) {
  const exits = new Map();
  for (const [lat, lng, label] of data.exits || []) {
    const key = cellOf({ lat, lng });
    if (!exits.has(key)) exits.set(key, []);
    exits.get(key).push({ lat, lng, label });
  }
  const routes = new Map();
  for (const r of data.routes || []) {
    const route = { op: r.op, names: r.names.map(lineKey), stops: r.stops.map(([lat, lng, platform]) => ({ lat, lng, platform })) };
    const key = r.op || '';
    if (!routes.has(key)) routes.set(key, []);
    routes.get(key).push(route);
  }
  return { exits, routes };
}

/*
 * A line's name as routes are matched by it: without the company, "Main"
 * (函館本線 is 函館線), what is in brackets, spaces and accents.
 */
export function lineKey(name) {
  return plain(String(name || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^(JR|ＪＲ)\s*/, '')
    .replace(/本線/g, '線')
    .replace(/\bMain Line\b/i, 'Line'))
    .replace(/[\s・\-]/g, '');
}

const sameLine = (route, names) => names.some((n) => n.length >= 2 && route.names.some((r) => r.includes(n) || (r.length >= 2 && n.includes(r))));

function nearestStop(stops, p, from = 0) {
  let best = -1;
  let bestKm = STOP_KM;
  for (let i = from; i < stops.length; i += 1) {
    const km = haversineKm(stops[i], p);
    if (km < bestKm) { best = i; bestKm = km; }
  }
  return best;
}

/** The platform a ride boards at, or null: { board, alight } points, its operator id and line names. */
export function platformFor(index, { board, alight, op, names }) {
  const keys = names.map(lineKey).filter(Boolean);
  const candidates = [...(index.routes.get(op || '') || []), ...(op ? index.routes.get('') || [] : [])];
  for (const route of candidates) {
    if (!sameLine(route, keys)) continue;
    const i = nearestStop(route.stops, board);
    if (i < 0 || !route.stops[i].platform) continue;
    if (nearestStop(route.stops, alight, i + 1) < 0) continue;
    return route.stops[i].platform;
  }
  return null;
}

/** The exit nearest `to` of those within reach of `station`, or null. */
export function exitFor(index, station, to) {
  let best = null;
  let bestKm = Infinity;
  const [r, c] = cellOf(station).split(',').map(Number);
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      for (const e of index.exits.get(`${r + dr},${c + dc}`) || []) {
        if (haversineKm(e, station) > EXIT_KM) continue;
        const km = haversineKm(e, to);
        if (km < bestKm) { best = e; bestKm = km; }
      }
    }
  }
  return best;
}

const ends = (leg) => {
  const path = leg.polyline ? decodePath(leg.polyline) : [];
  return path.length >= 2 ? [path[0], path[path.length - 1]] : null;
};

/**
 * Options with what the stations file knows filled in where it was missing:
 * each ride's `platform` ("Platform 3", "Platform 1 or 2") and the last
 * walk's `exit`, its polyline then going through the exit. Changes the
 * options in place and returns them.
 */
export function fillStationDetails(options, index) {
  if (!index) return options;
  for (const option of options) {
    option.legs.forEach((leg, i) => {
      if (leg.kind === 'ride' && !leg.platform) {
        const at = ends(leg);
        const op = leg.line.operator && leg.line.operator.key ? leg.line.operator.key.split('/')[1] : null;
        const platform = at && platformFor(index, { board: at[0], alight: at[1], op, names: [leg.line.local, leg.line.name] });
        if (platform) leg.platform = `Platform ${platform}`;
      }
      const last = i === option.legs.length - 1;
      if (leg.kind === 'walk' && last && !leg.exit && option.legs.some((l) => l.kind === 'ride')) {
        const at = ends(leg);
        const exit = at && exitFor(index, at[0], at[1]);
        if (exit) {
          leg.exit = exit.label;
          leg.polyline = encodePath([at[0], { lat: exit.lat, lng: exit.lng }, at[1]]);
        }
      }
    });
  }
  return options;
}
