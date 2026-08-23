import { placesKey, explain } from '@/lib/places';

/**
 * How to get from one point to another, and how long it takes.
 *
 * The Routes API is the successor to the Directions API and is the only way to
 * know a real travelling time: everything this app showed before was a
 * straight line across the map with an average walking speed applied to it,
 * which is a fine estimate over two streets and a fiction across a river.
 *
 * It cannot do turn-by-turn — nobody's API does, that is an app with your
 * location in its hand — so this draws the route and says what it costs you,
 * and handing over to a navigation app stays a separate, deliberate step.
 */

const ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/* Only what is drawn or read. The field mask is what the call is billed on,
   and asking for steps moves it into a dearer tier, so transit details are
   requested only when the mode is transit. */
const BASE_FIELDS = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
].join(',');

const TRANSIT_FIELDS = `${BASE_FIELDS},routes.legs.steps.transitDetails`;

export const MODES = [
  { id: 'WALK', label: 'Walk' },
  { id: 'TRANSIT', label: 'Transit' },
  { id: 'DRIVE', label: 'Drive' },
];

function clean(v) {
  const k = v || '';
  return !k || k.startsWith('REPLACE_WITH') ? '' : k;
}

/**
 * Routes API key. Falls back to the Places key, so one server key restricted
 * to both APIs is enough — same arrangement as geocoding.
 */
export function routesKey() {
  return clean(process.env.ROUTES_API_KEY) || placesKey();
}

export function routesNotConfigured() {
  console.error('[routes] ROUTES_API_KEY is not set and PLACES_API_KEY is not usable — '
    + 'routing is disabled. Enable Routes API on the key and restart.');
  return Response.json({
    error: 'Directions are switched off right now.',
    code: 'no_key',
  }, { status: 503 });
}

export function routesFailure(e, where) {
  console.error(`[routes] ${where} failed:`, explain(e));
  return Response.json(
    { error: 'Something went wrong on our end. Please try again.' },
    { status: 502 },
  );
}

/** "1234s" -> 1234. The API returns a protobuf duration, not a number. */
function seconds(d) {
  const n = parseInt(String(d || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** The named services a transit route puts you on, in order. */
function lines(route) {
  const out = [];
  (route.legs || []).forEach((leg) => {
    (leg.steps || []).forEach((step) => {
      const t = step.transitDetails;
      const line = t && t.transitLine;
      if (!line) return;
      out.push({
        name: line.nameShort || line.name || '',
        vehicle: (line.vehicle && line.vehicle.type) || '',
        colour: line.color || '',
        from: (t.stopDetails && t.stopDetails.departureStop
          && t.stopDetails.departureStop.name) || '',
      });
    });
  });
  return out.filter((l) => l.name).slice(0, 6);
}

export async function computeRoute({ from, to, mode }) {
  const travel = MODES.some((m) => m.id === mode) ? mode : 'WALK';
  const res = await fetch(ROUTES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': routesKey(),
      'X-Goog-FieldMask': travel === 'TRANSIT' ? TRANSIT_FIELDS : BASE_FIELDS,
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: travel,
      // Traffic-aware routing is a dearer tier and a walking route does not
      // care, so it is only asked for where it changes the answer.
      ...(travel === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
      polylineQuality: 'OVERVIEW',
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = (body.error && body.error.message) || '';
    } catch (e) { /* non-JSON body */ }
    throw new Error(detail || `Routes returned ${res.status}.`);
  }

  const body = await res.json();
  const route = (body.routes || [])[0];
  // No route is an answer, not a failure: there is no ferry to that island and
  // no train at four in the morning.
  if (!route) return { mode: travel, found: false };

  return {
    mode: travel,
    found: true,
    seconds: seconds(route.duration),
    metres: route.distanceMeters || 0,
    polyline: (route.polyline && route.polyline.encodedPolyline) || '',
    lines: travel === 'TRANSIT' ? lines(route) : [],
  };
}
