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
 * and drive to compare them asks once each rather than once a tap.
 */
export async function routeBetween(from, to, mode) {
  const key = `r:${from.lat.toFixed(4)},${from.lng.toFixed(4)}>`
    + `${to.lat.toFixed(4)},${to.lng.toFixed(4)}:${mode}`;
  if (cache.has(key)) return cache.get(key);
  const out = await post('/api/routes', { from, to, mode });
  cache.set(key, out);
  return out;
}

/**
 * Google's encoded polyline, unpacked.
 *
 * Done here rather than by loading Google's geometry library for the one
 * function this app needs from it: the format is a documented run of
 * zigzag-encoded deltas in base64-ish chunks, and it is thirty lines.
 */
export function decodePath(encoded) {
  const out = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < encoded.length) {
    let shift = 0;
    let result = 0;
    let b;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
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
