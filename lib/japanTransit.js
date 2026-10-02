import { timetableTransit } from './timetableRegions.js';
import { buildModel, modelJourney, modelRoute } from './railModel.js';
import { haversineKm, walkFor } from './timetable.js';

/**
 * Trains in Japan, where Google's Routes API has none: from real timetables
 * where they are published (lib/timetableRegions), and everywhere else an
 * estimate over every line in the country (lib/railModel). Either is shaped
 * like a Google transit route, with `source` saying which: 'timetable' or
 * 'model'.
 *
 * The nationwide network is 0.9 MB and builds in a tenth of a second, loaded
 * the first time a journey in Japan needs it and kept for the server's life.
 */

/* Roughly Japan, so a transit route in Paris never loads the network. The
   exact test is a station within reach of both ends, which also turns away
   Busan and Vladivostok, inside this box but far from any Japanese station. */
export const JAPAN_AREA = { south: 24.0, west: 122.9, north: 45.6, east: 146.0 };

const inJapan = (p) => p.lat >= JAPAN_AREA.south && p.lat <= JAPAN_AREA.north
  && p.lng >= JAPAN_AREA.west && p.lng <= JAPAN_AREA.east;

let model = null;
function network() {
  if (!model) {
    model = import('../data/transit/japan-rail.json')
      .then((m) => buildModel(m.default || m));
    // A failure is not kept: the next request tries again.
    model.catch(() => { model = null; });
  }
  return model;
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
 * A train journey between two points in Japan, or null where nothing reaches
 * and Google should be asked instead.
 *
 *   now  leave now: a timetable answers with the next train; the network has
 *        no clock, so where it answers, it is the same estimate either way
 */
export async function japanTransit({ from, to, now = false }) {
  return onFoot(from, to, await byTrain({ from, to, now }));
}

async function byTrain({ from, to, now }) {
  const timed = await timetableTransit({ from, to, now });
  const whole = timed.find((t) => t.region.complete);
  if (whole) return whole.route;

  const partial = timed.map((t) => t.route).filter((r) => r.found)
    .sort((a, b) => a.seconds - b.seconds)[0] || null;
  let estimate = null;
  if (inJapan(from) && inJapan(to)) {
    const net = await network();
    const journey = modelJourney(net, from, to);
    estimate = journey ? modelRoute(net, journey) : null;
  }
  return preferTimetable(partial, estimate, now) ? partial : estimate;
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
