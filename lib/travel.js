/*
 * How to get from one stop to the next: which ways Google can route where,
 * what to show when it cannot, and which way to suggest.
 *
 * Google's routing is not the same everywhere. Asked for the way from Tokyo
 * Station to Shibuya it gives a walk and a drive but no train — its Routes API
 * has no transit data for Japan, though the Google Maps app does. In Seoul it
 * is the other way round: trains and buses, no walking or driving. In mainland
 * China a "transit" route comes back as a walk with no line on it. So each
 * country's gaps are known here rather than discovered as "no route between
 * here and there", and a missing way is filled with an estimate that says it
 * is one.
 *
 * Nothing here knows about Google or the DOM, so it can be tested with node.
 */

export const TRAVEL_MODES = ['WALK', 'TRANSIT', 'DRIVE'];

export const TRAVEL_LABEL = { WALK: 'Walk', TRANSIT: 'Transit', DRIVE: 'Drive' };

// What the map's Routes setting can be: none, the suggested way for each hop, or one way for all.
export const ROUTE_SETTINGS = ['off', 'auto', ...TRAVEL_MODES];

/*
 * Where Google cannot route a way, by ISO 3166 numeric code — the codes the
 * app's country borders carry. Checked against the live API: Japan, Tokyo
 * Station to Shibuya; South Korea, Seoul Station to Gangnam; China, Futian to
 * Lianhuashan in Shenzhen. Hong Kong and Macao are their own entries in the
 * borders and route normally.
 */
const GAPS = {
  392: { name: 'Japan', missing: ['TRANSIT'] },
  410: { name: 'South Korea', missing: ['WALK', 'DRIVE'] },
  156: { name: 'China', missing: ['TRANSIT'] },
};

/** Whether Google can route this way in this country (a code, or null where unknown). */
export function canRoute(country, mode) {
  const gap = GAPS[Number(country)];
  return !gap || !gap.missing.includes(mode);
}

/** The country's name where Google has a gap, for saying why a time is an estimate. */
export function gapCountry(country) {
  const gap = GAPS[Number(country)];
  return gap ? gap.name : '';
}

/*
 * Whether an answer from Google is a real route this way. A transit route
 * with no line on it is a walk wearing a train's name — which is what mainland
 * China answers with — and would show a walking time as a train time.
 */
export function realRoute(result) {
  if (!result || !result.found || !Number.isFinite(result.seconds)) return false;
  if (result.mode === 'TRANSIT' && !(result.lines || []).length) return false;
  return true;
}

/*
 * A time from the straight-line distance alone, for a way Google cannot
 * route: walking at 4.5 km/h, as everywhere else in the app; a city train or
 * bus at 25 km/h with ten minutes of getting to it and waiting; a car at
 * 30 km/h through town with five minutes of parking. Rough, and always shown
 * as rough.
 */
export function estimateMinutes(km, mode) {
  const d = Math.max(0, Number(km) || 0);
  const minutes = mode === 'TRANSIT' ? 10 + (d / 25) * 60
    : mode === 'DRIVE' ? 5 + (d / 30) * 60
      : (d / 4.5) * 60;
  return Math.max(1, Math.round(minutes));
}

// Under this, a hop is a walk, wherever you are.
export const WALKABLE_KM = 1.2;

/*
 * The way to suggest for a hop: a walk when it is short, the train or bus when
 * it is not. Where walking cannot be routed (South Korea) a short hop is still
 * shown by transit, which can; where transit cannot (Japan) a long hop stays
 * transit anyway, as an estimate — in Tokyo that is how you would go, and a
 * driving route would be the wrong suggestion however well it was drawn.
 */
export function suggestMode(km, country) {
  if ((Number(km) || 0) < WALKABLE_KM) return canRoute(country, 'WALK') ? 'WALK' : 'TRANSIT';
  return 'TRANSIT';
}

/**
 * The ways worth showing for a hop, fastest first: each with its minutes,
 * whether it is a real route or an estimate, and the route's line to draw.
 *
 *   km       the straight-line distance
 *   country  where the hop starts, as an ISO numeric code, or null
 *   answers  { WALK, TRANSIT, DRIVE } from Google, where asked; undefined while waiting
 *
 * A way Google cannot route in that country is shown as an estimate; one it
 * could have routed but found nothing for (no ferry to that island) is left out.
 */
export function travelOptions(km, country, answers = {}) {
  return TRAVEL_MODES.map((mode) => {
    const answer = answers[mode];
    if (!canRoute(country, mode)) return { mode, minutes: estimateMinutes(km, mode), estimate: true };
    if (answer === undefined) return { mode, minutes: null, waiting: true };
    if (realRoute(answer)) {
      return { mode, minutes: Math.max(1, Math.round(answer.seconds / 60)), estimate: false, polyline: answer.polyline || '' };
    }
    // Transit that came back as a walk, where no gap is known: say it plainly as an estimate.
    if (mode === 'TRANSIT' && answer && answer.found) return { mode, minutes: estimateMinutes(km, mode), estimate: true };
    return null;
  }).filter(Boolean);
}

/** Which way the map draws for a hop under the Routes setting. */
export function drawnMode(setting, km, country) {
  if (!setting || setting === 'off') return null;
  return setting === 'auto' ? suggestMode(km, country) : setting;
}
