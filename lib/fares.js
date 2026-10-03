/*
 * What a train journey costs, where that is known (lib/trainOptions):
 *
 *   the open feeds  each publisher's own fares, by fare zone — exact, the
 *                   ticket fare (scripts/transit/build-gtfs.mjs)
 *   by distance     an operator's card fares by the distance ridden, from the
 *                   bands its registry entry lists (lib/registry: Tokyo
 *                   Metro's and Toei's subways today), less what changing
 *                   between two operators takes off (the registry's
 *                   transfers: ¥70 between those two)
 *
 * A fare from a distance is only as good as the distance: it is measured
 * station to station, not by the operator's own kilometres, so near the
 * edge of a band the answer is both fares ("¥209–252") rather than a guess.
 * Any operator without fares makes the whole journey's fare unknown (null),
 * never an estimate. A fare is in its country's currency.
 *
 * Nothing here knows about files, Next or the DOM.
 */

import { haversineKm } from './timetable.js';
import { operatorOf, operatorEntry, transferOff, countryOf } from './registry.js';

// Track runs a little longer than the straight lines between stations, and is measured a little differently.
const TRACK = 1.05;
const SLACK = 0.06;

/**
 * The fare in one band table for a distance: the band holding it, by whole
 * kilometres rounded up. A band's limit of null is any distance beyond.
 */
export function bandFare(bands, km) {
  const whole = Math.max(1, Math.ceil(km - 1e-9));
  const hit = bands.find(([upTo]) => upTo == null || whole <= upTo);
  return hit ? hit[1] : null;
}

/** An operator's card fares by distance, from its registry entry: { bands, vehicles } or null. */
export function cardFares(operator) {
  const entry = operatorEntry(operator && operator.key);
  return (entry && entry.fares && entry.fares.card) || null;
}

/** A distance fare, both fares where the distance is near a band's edge: { yen, upTo }. */
export function distanceFare(bands, km) {
  const lo = bandFare(bands, km * (1 - SLACK));
  const hi = bandFare(bands, km * (1 + SLACK));
  if (lo == null || hi == null) return null;
  return lo === hi ? { yen: lo, upTo: null } : { yen: lo, upTo: hi };
}

// The distance of a ride along its stops.
function rideKm(net, ride) {
  let km = 0;
  for (let i = 1; i < ride.stops.length; i += 1) {
    const a = net.stops[ride.stops[i - 1]];
    const b = net.stops[ride.stops[i]];
    if (a.lat != null && b.lat != null) km += haversineKm(a, b);
  }
  return km * TRACK;
}

/*
 * A fare by the open feeds' zones: the most particular rule for these zones
 * and lines, from where the operator was boarded to where it was left.
 */
function zoneFare(net, rides) {
  const from = net.stops[rides[0].from].zone;
  const to = net.stops[rides[rides.length - 1].to].zone;
  const lines = new Set(rides.map((r) => r.lineIndex));
  let best = null;
  let score = -1;
  net.fares.forEach(([line, a, b, yen]) => {
    if (line >= 0 && !lines.has(line)) return;
    if (a >= 0 && a !== from) return;
    if (b >= 0 && b !== to) return;
    const s = (a >= 0) + (b >= 0) + (line >= 0);
    if (s > score) { score = s; best = yen; }
  });
  return best == null ? null : { yen: best, upTo: null };
}

/**
 * The fare for a timetabled journey: { total, upTo, parts: [{ operator, yen, upTo }],
 * basis: 'card' | 'ticket', currency, card }, `upTo` set where the fare may be
 * the higher of two and `card` the name of the card it is paid with; or null
 * where any part of it is unknown.
 */
export function timetableFare(net, journey) {
  const rides = journey.legs.filter((l) => l.kind === 'ride');
  if (!rides.length) return null;
  // One fare per operator ridden in a row, as the gates charge it.
  const runs = [];
  rides.forEach((r) => {
    const line = net.lines[r.lineIndex];
    const operator = operatorOf(line[3]);
    const key = operator ? operator.key || operator.name : `?${r.lineIndex}`;
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.rides.push(r);
    else runs.push({ key, operator, rides: [r] });
  });

  const parts = [];
  let basis = null;
  for (const run of runs) {
    const lines = run.rides.map((r) => net.lines[r.lineIndex]);
    const card = cardFares(run.operator);
    let fare = null;
    let kind = null;
    if (net.fares.length && run.rides.every((r) => net.stops[r.from].zone >= 0)) {
      fare = zoneFare(net, run.rides);
      kind = 'ticket';
    } else if (card && lines.every((l) => !card.vehicles || card.vehicles.includes(l[2]))) {
      fare = distanceFare(card.bands, run.rides.reduce((km, r) => km + rideKm(net, r), 0));
      kind = 'card';
    }
    if (!fare) return null;
    if (basis && basis !== kind) return null;
    basis = kind;
    parts.push({ operator: run.operator, yen: fare.yen, upTo: fare.upTo });
  }

  let off = 0;
  for (let i = 1; i < parts.length; i += 1) off += transferOff(parts[i - 1].operator, parts[i].operator, basis);
  const total = parts.reduce((n, p) => n + p.yen, 0) - off;
  const most = parts.reduce((n, p) => n + (p.upTo || p.yen), 0) - off;
  if (off) parts.push({ operator: null, discount: true, yen: -off, upTo: null });
  const country = countryOf((operatorEntry(parts[0].operator && parts[0].operator.key) || {}).country) || {};
  return {
    total, upTo: most !== total ? most : null, parts, basis,
    currency: country.currency || null, card: basis === 'card' ? country.card || 'Card' : null,
  };
}
