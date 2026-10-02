import {
  buildNetwork, covers, typicalJourney, earliestJourney, asRoute, tokyoClock,
} from './timetable.js';

/**
 * Trains in greater Tokyo, from the operators' timetables, for the transit
 * routes Google's API does not have in Japan (see lib/timetable).
 *
 * The timetable is 2.5 MB and takes a quarter of a second to unpack, so it is
 * loaded only the first time a transit route is asked for somewhere it could
 * cover, and each day's network is then kept for the life of the server.
 */

/*
 * Roughly where the timetable reaches — Utsunomiya to Izu, Kawaguchiko to
 * Choshi — so a transit route in London or Singapore never loads it. The
 * exact test, a station within reach of both ends, is covers().
 */
export const TOKYO_AREA = { south: 34.5, west: 138.3, north: 37.2, east: 141.0 };

const inArea = (p) => p.lat >= TOKYO_AREA.south && p.lat <= TOKYO_AREA.north
  && p.lng >= TOKYO_AREA.west && p.lng <= TOKYO_AREA.east;

let data = null;
const networks = new Map();

function network(day) {
  if (!networks.has(day)) {
    if (!data) data = import('../data/transit/tokyo-rail.json').then((m) => m.default || m);
    const built = data.then((d) => buildNetwork(d, day));
    // A failure is not kept: the next request tries again.
    built.catch(() => { networks.delete(day); data = null; });
    networks.set(day, built);
  }
  return networks.get(day);
}

/**
 * A train journey between two points, shaped like a Google transit route, or
 * null where the timetable does not reach and Google should be asked instead.
 *
 *   now  leave now, on today's timetable — directions while travelling;
 *        otherwise a typical weekday late morning, for planning
 */
export async function tokyoTransit({ from, to, now = false }) {
  if (!inArea(from) || !inArea(to)) return null;
  const clock = now ? tokyoClock() : null;
  const net = await network(clock ? clock.day : 'weekday');
  if (!covers(net, from, to)) return null;
  const journey = clock
    ? earliestJourney(net, from, to, clock.minute)
    : typicalJourney(net, from, to);
  // Inside the timetable but no train: after the last one tonight. Not Google's to answer either.
  if (!journey) return { mode: 'TRANSIT', found: false, source: 'timetable' };
  return asRoute(net, journey);
}
