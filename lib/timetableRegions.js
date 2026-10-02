import {
  buildNetwork, covers, typicalJourney, earliestJourney, asRoute, tokyoClock,
} from './timetable.js';

/**
 * Where trains in Japan can be planned from real timetables (lib/timetable):
 * greater Tokyo, from every operator, and cities whose operators publish an
 * open GTFS feed (scripts/transit/build-gtfs.mjs).
 *
 * `complete` says whether a region's timetable has every railway there.
 * Tokyo's does, so its answer stands. The others are one operator each —
 * Fukuoka's subway, not JR or Nishitetsu — so lib/japanTransit takes their
 * answer only where it is no slower than the estimate over every line.
 *
 * `area` is roughly where each reaches, so a journey elsewhere never loads the
 * file; the exact test, a station within reach of both ends, is covers().
 * Each file is loaded on the first journey it could answer, and each day's
 * network kept for the life of the server.
 */
export const REGIONS = [
  {
    // Utsunomiya to Izu, Kawaguchiko to Choshi.
    id: 'tokyo',
    complete: true,
    area: { south: 34.5, west: 138.3, north: 37.2, east: 141.0 },
    load: () => import('../data/transit/tokyo-rail.json'),
  },
  {
    // Japan's other open railway timetables, one file: Fukuoka's subway, the
    // Kumamoto, Kōchi, Toyama and Takaoka trams, and five smaller railways
    // (scripts/transit/build-gtfs.mjs). Each is one operator among several.
    id: 'open',
    complete: false,
    area: { south: 24.0, west: 122.9, north: 45.6, east: 146.0 },
    load: () => import('../data/transit/open-rail.json'),
  },
];

export const TOKYO_AREA = REGIONS[0].area;

const inside = (area, p) => p.lat >= area.south && p.lat <= area.north
  && p.lng >= area.west && p.lng <= area.east;

const files = new Map();
const networks = new Map();

function network(region, day) {
  const key = `${region.id}|${day}`;
  if (!networks.has(key)) {
    if (!files.has(region.id)) files.set(region.id, region.load().then((m) => m.default || m));
    const built = files.get(region.id).then((d) => buildNetwork(d, day));
    // A failure is not kept: the next request tries again.
    built.catch(() => { networks.delete(key); files.delete(region.id); });
    networks.set(key, built);
  }
  return networks.get(key);
}

/**
 * Timetabled journeys between two points, one from each region that reaches
 * both: [{ region, route }], each route shaped like a Google transit route,
 * or { found: false } where no train runs (after tonight's last).
 *
 *   now  leave now, on today's timetable; otherwise a typical weekday late morning
 */
export async function timetableTransit({ from, to, now = false }) {
  const clock = now ? tokyoClock() : null;
  const out = [];
  for (const region of REGIONS) {
    if (!inside(region.area, from) || !inside(region.area, to)) continue;
    const net = await network(region, clock ? clock.day : 'weekday');
    if (!covers(net, from, to)) continue;
    const journey = clock ? earliestJourney(net, from, to, clock.minute) : typicalJourney(net, from, to);
    out.push({ region, route: journey ? asRoute(net, journey) : { mode: 'TRANSIT', found: false, source: 'timetable' } });
  }
  return out;
}
