import { tokyoTransit } from './tokyoTransit.js';
import { buildModel, modelJourney, modelRoute } from './railModel.js';

/**
 * Trains in Japan, where Google's Routes API has none: greater Tokyo from the
 * operators' timetables (lib/tokyoTransit), and everywhere else an estimate
 * over every line in the country (lib/railModel). Either is shaped like a
 * Google transit route, with `source` saying which: 'timetable' or 'model'.
 *
 * The nationwide network is 0.9 MB and builds in a tenth of a second, loaded
 * the first time a journey in Japan is asked for and kept for the server's life.
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

/**
 * A train journey between two points in Japan, or null where neither the
 * timetable nor the network reaches and Google should be asked instead.
 *
 *   now  leave now: Tokyo's timetable answers with the next train; the
 *        network has no clock, so elsewhere it is the same estimate either way
 */
export async function japanTransit({ from, to, now = false }) {
  const timed = await tokyoTransit({ from, to, now });
  if (timed) return timed;
  if (!inJapan(from) || !inJapan(to)) return null;
  const net = await network();
  const journey = modelJourney(net, from, to);
  return journey ? modelRoute(net, journey) : null;
}
