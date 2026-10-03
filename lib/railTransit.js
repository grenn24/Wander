import { timetableTransit } from './timetableRegions.js';
import { buildModel, modelJourney, modelRoute } from './railModel.js';
import { haversineKm, walkFor, asRoute } from './timetable.js';
import { timetableOptions, modelOptions } from './trainOptions.js';
import { countryOf } from './registry.js';

/**
 * Trains the app plans itself, where Google's Routes API has none (Japan):
 * from real timetables where they are published (lib/timetableRegions), and
 * everywhere else an estimate over every line in the country (lib/railModel),
 * for each country whose network is modelled (NETWORKS). Either is shaped
 * like a Google transit route, with `source` saying which: 'timetable' or
 * 'model'.
 *
 * Japan's network is 0.9 MB and builds in a tenth of a second, loaded the
 * first time a journey there needs it and kept for the server's life.
 */

/*
 * The countries whose whole railway network is modelled: its registry country
 * (lib/registry), a box round it so that a transit route in Paris never loads
 * Japan's network, and its file (scripts/transit/build-japan.mjs). The exact
 * test is a station within reach of both ends, which also turns away Busan
 * and Vladivostok, inside Japan's box but far from any Japanese station.
 */
export const NETWORKS = [
  {
    country: 'JP',
    area: { south: 24.0, west: 122.9, north: 45.6, east: 146.0 },
    load: () => import('../data/transit/japan-rail.json'),
  },
];

const inside = (area, p) => p.lat >= area.south && p.lat <= area.north
  && p.lng >= area.west && p.lng <= area.east;

const models = new Map();
function network(entry) {
  if (!models.has(entry.country)) {
    const built = entry.load().then((m) => buildModel(m.default || m));
    // A failure is not kept: the next request tries again.
    built.catch(() => models.delete(entry.country));
    models.set(entry.country, built);
  }
  return models.get(entry.country);
}

/*
 * A partial timetable, one city's subway, against the estimate over every
 * line. The timetable wins unless it is clearly slower: then it is the subway
 * being made to do a journey a JR line next door would do better. Leaving
 * now, it is allowed more, since its time includes the wait for the actual
 * next train and the estimate's an average.
 */
export function preferTimetable(timed, estimate, now = false) {
  if (!timed || !timed.found) return false;
  if (!estimate) return true;
  return timed.seconds <= estimate.seconds + (now ? 10 : 5) * 60;
}

/**
 * A train journey between two points, or null where nothing the app has
 * reaches both and Google should be asked instead.
 *
 *   now     leave now: a timetable answers with the next train; the network
 *           has no clock, so where it answers, it is the same estimate either way
 *   prefer  a saved route's line ids: when those lines run, they are the answer
 *
 * The answer carries `options`, the other ways to compare (lib/trainOptions),
 * and `preferMissing` when a saved route's lines do not run then.
 */
export async function railTransit({ from, to, now = false, prefer = null }) {
  const found = await byTrain({ from, to, now });
  if (!found || !found.route) return found ? found.route : null;
  let { route } = found;
  const extra = {};
  if (route.found && found.plan) {
    const planned = found.plan(prefer);
    if (planned.options.length) {
      extra.options = planned.options;
      // The clock the options' times keep, for leaving now (lib/util zonedNow).
      const country = countryOf(found.country);
      if (country) extra.timeZone = country.timeZone;
    }
    if (planned.preferMissing) extra.preferMissing = true;
    // A saved route that runs is what the hop shows.
    else if (prefer && prefer.length && planned.journeys[0]) route = found.answer(planned.journeys[0]);
  }
  const out = onFoot(from, to, route);
  return out && out.found ? { ...out, ...extra } : out;
}

/*
 * The answer by train, with how to plan the other ways from the same
 * timetable or network (`plan`) and how to give one of them as an answer
 * (`answer`).
 */
async function byTrain({ from, to, now }) {
  const timed = await timetableTransit({ from, to, now });
  const fromTimetable = (t) => ({
    country: t.region.country,
    route: t.route,
    plan: (prefer) => timetableOptions(t.net, from, to, { minute: t.minute, prefer }),
    answer: (journey) => asRoute(t.net, journey),
  });
  const whole = timed.find((t) => t.region.complete);
  if (whole) return fromTimetable(whole);

  const partial = timed.filter((t) => t.route.found)
    .sort((a, b) => a.route.seconds - b.route.seconds)[0] || null;
  let estimate = null;
  const modelled = NETWORKS.find((n) => inside(n.area, from) && inside(n.area, to));
  if (modelled) {
    const net = await network(modelled);
    const journey = modelJourney(net, from, to);
    if (journey) {
      estimate = {
        country: modelled.country,
        route: modelRoute(net, journey),
        plan: (prefer) => modelOptions(net, from, to, { prefer }),
        answer: (j) => modelRoute(net, j),
      };
    }
  }
  if (preferTimetable(partial && partial.route, estimate && estimate.route, now)) return fromTimetable(partial);
  return estimate;
}

/*
 * A train has to beat walking to be worth taking. Up the hill from
 * Kiyomizu-dera to Gion is 1.3 km: the quickest train is a 40-minute detour
 * and the walk is under twenty. Then the answer is the walk, said as such
 * (`source: 'walk'`), the way Google's transit answers with a walk when no
 * vehicle helps — not a train nobody would catch.
 */
export function onFoot(from, to, route) {
  if (!route || !route.found) return route;
  const km = haversineKm(from, to);
  const walking = walkFor(km);
  if (route.seconds / 60 <= walking) return route;
  return {
    mode: 'TRANSIT',
    found: true,
    source: 'walk',
    seconds: walking * 60,
    metres: Math.round(km * 1000),
    polyline: '',
    lines: [],
  };
}
