/*
 * The trains of one leg of a journey for the rest of the day, by timetable
 * (lib/timetable): every train of that line leaving the station it is
 * boarded at, the same way, that stops where you get off — with when it gets
 * you to the end of the journey, the changes after it included.
 *
 * Nothing here knows about files, Next or the DOM.
 */

import { earliestJourney, walkFor, haversineKm } from './timetable.js';

// The service day runs to three in the morning (lib/timetable tokyoClock).
export const DAY_END = 27 * 60;
const OUT = 1;

/**
 *   net      the timetable network
 *   ride     a ride leg of a journey from earliestJourney (stops are stop indexes)
 *   rest     the line indexes ridden after this one, or none
 *   to       where the journey ends, { lat, lng }
 *   after    the earliest minute to leave the station
 *   until    the last minute to list (the end of the service day)
 *
 * Returns { trains: [{ leaves, reaches, arrives, type }], last } — `reaches`
 * the stop you get off at, `arrives` the end of the journey, `last` the last
 * of them (or null when none run after `after`).
 */
export function departures(net, ride, { rest = [], to, after, until = DAY_END }) {
  const { legs } = net;
  const [here, next] = ride.stops;
  const off = ride.stops[ride.stops.length - 1];
  if (next == null) return { trains: [], last: null };

  // The first leg leaving at or after `after`, by halving.
  let lo = 0;
  let hi = legs.count;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (legs.dep[mid] < after) lo = mid + 1; else hi = mid; }

  const only = rest.length ? new Set(rest) : null;
  const walkOff = walkFor(haversineKm(net.stops[off], to)) + OUT;
  const trains = [];
  for (let c = lo; c < legs.count && legs.dep[c] <= until; c += 1) {
    if (legs.from[c] !== here || legs.to[c] !== next) continue;
    const train = legs.trip[c];
    const reaches = reachOf(net, train, c, off);
    if (reaches == null) continue; // runs past, or ends before, where you get off
    let arrives = reaches + walkOff;
    if (only) {
      const onward = earliestJourney(net, net.stops[off], to, reaches, { only });
      if (!onward) continue;
      arrives = onward.arrives;
    }
    trains.push({ leaves: legs.dep[c], reaches, arrives, type: net.types[net.trains[train].type] || '' });
  }
  return { trains, last: trains.length ? trains[trains.length - 1] : null };
}

// When a train, from its leg c, reaches stop `off`: by the train's own legs in order, or null.
function reachOf(net, train, c, off) {
  const own = net.own.legs.subarray(net.own.start[train], net.own.start[train + 1]);
  const at = own.indexOf(c);
  if (at < 0) return null;
  for (let k = at; k < own.length; k += 1) {
    if (net.legs.to[own[k]] === off) return net.legs.arr[own[k]];
  }
  return null;
}

/** Which timetable a date runs: weekends on Saturday and Sunday; holidays are not known. */
export function dayOf(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday === 0 || weekday === 6 ? 'weekend' : 'weekday';
}
