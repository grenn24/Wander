'use client';

/**
 * Client-side geo helpers. Everything that needs a key goes through our own
 * routes under /api/places, so the Google key stays on the server; what is left
 * here is arithmetic and formatting.
 */

export const NEARBY_KINDS = [
  { id: 'food', label: 'Food & drink', category: 'food' },
  { id: 'sights', label: 'Sights', category: 'sightseeing' },
  { id: 'transit', label: 'Transit', category: 'transport' },
  { id: 'shops', label: 'Shops', category: 'shopping' },
];

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

/** Candidate places for a free-text query. */
export async function searchPlaces(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (cache.has(`s:${q}`)) return cache.get(`s:${q}`);
  const { places } = await post('/api/places/search', { query: q });
  cache.set(`s:${q}`, places || []);
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

/** Places of one kind around a point. */
export async function nearby(lat, lng, kind, radius = 900) {
  const key = `n:${lat.toFixed(3)},${lng.toFixed(3)},${kind},${radius}`;
  if (cache.has(key)) return cache.get(key);
  const { places } = await post('/api/places/nearby', { lat, lng, kind, radius });
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

/** Rough walking time, at 4.5 km/h. Straight-line, so it under-reads. */
export function walkMinutes(km) {
  return Math.round((km / 4.5) * 60);
}
