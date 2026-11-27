'use client';

/**
 * Client-side geo helpers. Everything that needs a key goes through our own
 * routes under /api/places, so the Google key stays on the server; what is left
 * here is arithmetic and formatting.
 */

export { NEARBY_KINDS } from './explore.js';

const cache = new Map();

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.code = json.code;
    throw err;
  }
  return json;
}

/**
 * Candidate places for a free-text query, optionally biased to what is on
 * screen. The cache key has to include the point, or a search made while
 * looking at Kyoto would be answered from one made while looking at Tokyo.
 */
export async function searchPlaces(query, near = null) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = near ? `s:${q}@${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : `s:${q}`;
  if (cache.has(key)) return cache.get(key);
  const { places } = await post('/api/places/search', {
    query: q,
    ...(near ? { lat: near.lat, lng: near.lng, radius: near.radius } : {}),
  });
  cache.set(key, places || []);
  return places || [];
}

/** Coordinates -> a human place name. */
export async function reverseGeocode(lat, lng) {
  const key = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(`/api/places/reverse?lat=${lat}&lng=${lng}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || 'Lookup failed.');
    err.code = json.code;
    throw err;
  }
  cache.set(key, json);
  return json;
}

/**
 * What we already know about a place, without asking and without waiting.
 *
 * The difference between a modal that opens finished and one that opens and
 * then fills in is a single render, and an await — even of a promise that is
 * already resolved — is one render too late.
 */
export function cachedDetails(placeId) {
  const id = String(placeId || '');
  return id && cache.has(`d:${id}`) ? cache.get(`d:${id}`) : null;
}

/*
 * Asks that have not come back yet, kept apart from the answers that have.
 *
 * Two things want this at once — the click that opens the editor and the panel
 * inside it — and if the first is still in the air when the second asks, the
 * second must join it rather than start another. Place Details is the dearest
 * call this app makes, and paying twice for one place because a lookup was
 * slow is exactly the wrong way to lose money.
 */
const flight = new Map();

/** Photographs, rating and reviews for a place — one call, cached per tab. */
export function placeDetails(placeId) {
  const id = String(placeId || '');
  if (!id) return Promise.resolve(null);
  const key = `d:${id}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (flight.has(key)) return flight.get(key);

  const asked = (async () => {
    // `v` names the answer's shape: the route is cached at the edge by URL,
    // and an answer cached before the place panel's fields has none of them.
    const res = await fetch(`/api/places/details?place_id=${encodeURIComponent(id)}&v=2`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Lookup failed.');
    return json;
  })().then(
    (json) => { cache.set(key, json); flight.delete(key); return json; },
    (e) => { flight.delete(key); throw e; },
  );

  flight.set(key, asked);
  return asked;
}

/**
 * A real route between two points, for one way of travelling.
 *
 * Cached per tab by both ends and the mode, so flicking between walk, transit
 * and drive to compare them asks once each rather than once a tap. A train
 * leaving now is not cached: in an hour it has left.
 *
 *   now     transit from now, not a typical journey (the server's timetables only)
 *   google  false where Google has no such route in this country
 *   prefer  a saved route's line ids (trains in Japan), put first when they run
 */
export async function routeBetween(from, to, mode, { now = false, google = true, prefer = null } = {}) {
  const saved = prefer && prefer.length ? prefer : null;
  const key = `r:${from.lat.toFixed(4)},${from.lng.toFixed(4)}>`
    + `${to.lat.toFixed(4)},${to.lng.toFixed(4)}:${mode}${google ? '' : ':own'}${saved ? `:${saved.join('>')}` : ''}`;
  if (!now && cache.has(key)) return cache.get(key);
  const out = await post('/api/routes', {
    from, to, mode, ...(now ? { now: true } : {}), ...(google ? {} : { google: false }),
    ...(saved ? { prefer: saved } : {}),
  });
  if (!now) cache.set(key, out);
  return out;
}

/**
 * A train's departures for the rest of the day (app/api/departures): the
 * trains of one of a train option's lines, from `after`, with when each gets
 * you there. Not kept: the answer depends on the time asked.
 */
export function departuresOf({ from, to, option, ride = 0, after, date, now = false }) {
  return post('/api/departures', { from, to, option, ride, after, ...(date ? { date } : {}), ...(now ? { now: true } : {}) });
}

export { decodePath } from './polyline.js';

/**
 * The same route, with the points a map cannot show taken out.
 *
 * Google returns a route the way a car drives it: a drive across a city comes
 * back with hundreds of points, most of them a few metres apart. A day's stops
 * make a few dozen of those, and on a phone the 3D map carries every one of
 * those vertices in every frame it draws, which is felt as a map that will not
 * keep up with a finger. Points closer together than `metres` along the way
 * are dropped; the ends and the corners between them are kept, so the line
 * still follows the roads it did.
 */
export function thinPath(points, metres = 12) {
  const all = (points || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (all.length < 3) return all;
  const out = [all[0]];
  let last = all[0];
  for (let i = 1; i < all.length - 1; i += 1) {
    if (haversine(last.lat, last.lng, all[i].lat, all[i].lng) * 1000 >= metres) {
      out.push(all[i]);
      last = all[i];
    }
  }
  out.push(all[all.length - 1]);
  return out;
}

/** Places of one kind around a point. */
export async function nearby(lat, lng, kind, radius = 900, bounds = null) {
  const extent = bounds ? ['north', 'south', 'east', 'west'].map((k) => bounds[k].toFixed(4)).join(',') : '';
  const key = `n:${lat.toFixed(3)},${lng.toFixed(3)},${kind},${radius},${extent}`;
  if (cache.has(key)) return cache.get(key);
  const { places } = await post('/api/places/nearby', { lat, lng, kind, radius, bounds });
  cache.set(key, places || []);
  return places || [];
}

/* ------------------------------------------------------------- distance --- */

/** Great-circle distance in km. */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function fmtKm(km) {
  if (km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

const isPoint = (lat, lng) => Number.isFinite(lat) && Math.abs(lat) <= 90
  && Number.isFinite(lng) && Math.abs(lng) <= 180;

/**
 * The far end of a journey, as written on it: a flight's "To", a taxi's drop
 * off. Every mode keeps that end in details.to (lib/transport).
 */
function arrivalText(a) {
  return a && a.category === 'transport' ? String(a.details?.to || '').trim() : '';
}

/**
 * Where an activity leaves you.
 *
 * Most things finish where they are pinned. A flight, train or transfer is
 * pinned where it departs, so it finishes at its arrival pin, which is only
 * believed while it was found for the words in "To" now. With no such pin,
 * where it finishes is unknown, not where it set off: the way to Ginza after
 * NH804 starts at Narita, not at Changi.
 */
export function activityEnd(a) {
  if (!a) return null;
  if (arrivalText(a)) {
    const pin = a.details._arrive;
    return pin && pin.q === arrivalText(a) && isPoint(pin.lat, pin.lng)
      ? { lat: pin.lat, lng: pin.lng } : null;
  }
  return isPoint(a.lat, a.lng) ? { lat: a.lat, lng: a.lng } : null;
}

/** Only adjacent, located activities on the same day describe a transfer. */
export function activityDistance(from, to) {
  if (!from?.day || from.day !== to?.day || !to || !isPoint(to.lat, to.lng)) return null;
  const start = activityEnd(from);
  return start ? haversine(start.lat, start.lng, to.lat, to.lng) : null;
}

/**
 * The arrival ends still to be found: one lookup for each journey whose "To"
 * has words and no pin found for them. A bare code is a lottery as a search,
 * so a flight's asks for the airport and a train's for the station.
 */
export function arrivalQueries(activities) {
  const hints = { flight: 'airport', train: 'station' };
  return (Array.isArray(activities) ? activities : [])
    .filter((a) => a && a.id != null && arrivalText(a) && !activityEnd(a))
    .map((a) => {
      const to = arrivalText(a);
      const hint = hints[a.subtype];
      return {
        id: String(a.id),
        to,
        query: hint && !to.toLowerCase().includes(hint) ? `${to} ${hint}` : to,
        // The place being looked for, not the journey's own name: "Flight
        // NH804 Singapore → Tokyo" is nothing a candidate could be called.
        title: to,
        category: 'transport',
        day: a.day || '',
      };
    });
}

/**
 * Each answer as the arrival pin it gives: { id, pin } for every journey found,
 * keeping the words it was found for so a later change to "To" retires it. A
 * match the second opinion rejected is no pin at all, as for any other place.
 */
export function arrivalPins(queries, results) {
  const asked = new Map((Array.isArray(queries) ? queries : []).map((q) => [q.id, q]));
  return (Array.isArray(results) ? results : [])
    .filter((r) => r && r.found && r.confidence !== 'low' && asked.has(String(r.id))
      && r.lat != null && r.lng != null && isPoint(Number(r.lat), Number(r.lng)))
    .map((r) => ({
      id: String(r.id),
      pin: { q: asked.get(String(r.id)).to, lat: Number(r.lat), lng: Number(r.lng) },
    }));
}

/** Rough walking time, at 4.5 km/h. Straight-line, so it under-reads. */
export function walkMinutes(km) {
  return Math.round((km / 4.5) * 60);
}

/**
 * What to look up for new entries before they are saved: one item per entry
 * that has words for a place and no pin yet, keyed by its position.
 */
export function pinQueries(drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  return list
    .map((d, i) => ({
      id: String(i),
      query: String((d && d.location) || '').trim(),
      title: String((d && d.title) || '').trim(),
      category: (d && d.category) || '',
      day: (d && d.day) || '',
    }))
    // Something already pinned has had its answer.
    .filter((item, i) => item.query && (list[i] || {}).lat == null);
}

/**
 * Google's answers laid onto the entries they were for. The street address
 * replaces the words, and the pin and photo come with it. A match the second
 * opinion rejected ('low') keeps its words and no pin: a wrong pin is worse
 * than none, and the editor can still offer the match.
 */
export function applyPins(drafts, results) {
  const out = (Array.isArray(drafts) ? drafts : []).slice();
  (Array.isArray(results) ? results : []).forEach((hit) => {
    if (!hit || !hit.found || hit.confidence === 'low') return;
    const i = Number(hit.id);
    if (!Number.isInteger(i) || !out[i]) return;
    if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return;
    out[i] = {
      ...out[i],
      location: hit.label || out[i].location,
      lat: hit.lat,
      lng: hit.lng,
      place_id: hit.place_id || null,
      photo_ref: hit.photo_ref || null,
    };
  });
  return out;
}
