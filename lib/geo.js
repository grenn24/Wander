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
    const res = await fetch(`/api/places/details?place_id=${encodeURIComponent(id)}`);
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
 */
export async function routeBetween(from, to, mode, { now = false, google = true } = {}) {
  const key = `r:${from.lat.toFixed(4)},${from.lng.toFixed(4)}>`
    + `${to.lat.toFixed(4)},${to.lng.toFixed(4)}:${mode}${google ? '' : ':own'}`;
  if (!now && cache.has(key)) return cache.get(key);
  const out = await post('/api/routes', {
    from, to, mode, ...(now ? { now: true } : {}), ...(google ? {} : { google: false }),
  });
  if (!now) cache.set(key, out);
  return out;
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

/** Only adjacent, located activities on the same day describe a transfer. */
export function activityDistance(from, to) {
  const located = (a) => a && Number.isFinite(a.lat) && Math.abs(a.lat) <= 90
    && Number.isFinite(a.lng) && Math.abs(a.lng) <= 180;
  if (!from?.day || from.day !== to?.day || !located(from) || !located(to)) return null;
  return haversine(from.lat, from.lng, to.lat, to.lng);
}

/** Rough walking time, at 4.5 km/h. Straight-line, so it under-reads. */
export function walkMinutes(km) {
  return Math.round((km / 4.5) * 60);
}
