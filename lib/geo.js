'use client';

/**
 * Geo helpers over OpenStreetMap services. Both are free and keyless, and both
 * ask callers to be gentle: Nominatim allows at most one request per second and
 * forbids bulk use, Overpass is a shared community server. So every call here
 * goes through one global queue and an in-memory cache, and nothing fans out.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

const MIN_GAP_MS = 1100; // Nominatim's stated limit is 1 req/sec.
let lastCall = 0;
let chain = Promise.resolve();

/** Serialises every outbound geo request and spaces them out. */
function queued(fn) {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  // Keep the chain alive even when one call rejects.
  chain = run.then(() => undefined, () => undefined);
  return run;
}

const forwardCache = new Map();
const reverseCache = new Map();
const nearbyCache = new Map();

/* --------------------------------------------------------------- search --- */

/** Free-text place search. Returns [{ label, lat, lng }]. */
export async function geocode(query, limit = 6) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = `${q}|${limit}`;
  if (forwardCache.has(key)) return forwardCache.get(key);

  const out = await queued(async () => {
    const url = `${NOMINATIM}/search?format=json&limit=${limit}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Place search failed (${res.status})`);
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json.map((h) => ({
      label: h.display_name,
      lat: Number(h.lat),
      lng: Number(h.lon),
    }));
  });

  forwardCache.set(key, out);
  return out;
}

/** Best single match for a place name, or null. */
export async function geocodeOne(query) {
  const hits = await geocode(query, 1);
  return hits[0] || null;
}

/**
 * Resolve an activity's location, optionally disambiguated by the trip's
 * destination.
 *
 * The destination is free text ("Tokyo & Nagoya"), and Nominatim treats every
 * comma-separated part as a real place component — so appending it wholesale
 * turns a query that works into one that returns nothing. Try the location on
 * its own first, and only fall back to a hint narrowed to its first place name.
 */
export async function geocodeBest(location, destination) {
  const loc = String(location || '').trim();
  if (!loc) return null;

  const direct = await geocodeOne(loc);
  if (direct) return direct;

  const hint = String(destination || '').split(/[,&/]|\band\b/i)[0].trim();
  if (!hint || loc.toLowerCase().includes(hint.toLowerCase())) return null;
  return geocodeOne(`${loc}, ${hint}`);
}

/** Coordinates -> a human place name. */
export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (reverseCache.has(key)) return reverseCache.get(key);

  const out = await queued(async () => {
    const url = `${NOMINATIM}/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
    const json = await res.json();
    const name = json && (json.name || (json.address && (
      json.address.attraction || json.address.tourism || json.address.building
      || json.address.shop || json.address.amenity || json.address.road
    )));
    return {
      label: (json && json.display_name) || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      name: name || '',
    };
  });

  reverseCache.set(key, out);
  return out;
}

/* --------------------------------------------------------------- nearby --- */

export const NEARBY_KINDS = [
  { id: 'food', label: 'Food & drink', category: 'food' },
  { id: 'sights', label: 'Sights', category: 'sightseeing' },
  { id: 'transit', label: 'Transit', category: 'transport' },
  { id: 'shops', label: 'Shops', category: 'shopping' },
];

const FILTERS = {
  food: ['node["amenity"~"^(restaurant|cafe|fast_food|bar|pub|ice_cream)$"]'],
  sights: ['node["tourism"~"^(attraction|museum|viewpoint|artwork|gallery|zoo|theme_park)$"]'],
  transit: ['node["railway"="station"]', 'node["public_transport"="station"]'],
  shops: ['node["shop"~"^(department_store|mall|supermarket|convenience|books|clothes|gift|bakery)$"]'],
};

/**
 * Places of one kind within `radius` metres. Overpass is a shared community
 * server, so results are cached per rounded coordinate and the radius is capped.
 */
export async function nearby(lat, lng, kind, radius = 900) {
  const filters = FILTERS[kind];
  if (!filters) return [];
  const r = Math.min(2000, Math.max(200, radius));
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}|${kind}|${r}`;
  if (nearbyCache.has(key)) return nearbyCache.get(key);

  const body = `[out:json][timeout:20];(${
    filters.map((f) => `${f}(around:${r},${lat},${lng});`).join('')
  });out body 40;`;

  const out = await queued(async () => {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
    if (!res.ok) throw new Error(`Nearby search failed (${res.status})`);
    const json = await res.json();
    const seen = new Set();
    return (json.elements || [])
      .filter((e) => e.tags && e.tags.name && e.lat != null && e.lon != null)
      .map((e) => ({
        id: `osm-${e.id}`,
        name: e.tags.name,
        kind,
        lat: e.lat,
        lng: e.lon,
        detail: e.tags.cuisine || e.tags.tourism || e.tags.shop || e.tags.amenity || '',
        km: haversine(lat, lng, e.lat, e.lon),
      }))
      .filter((p) => {
        const k = p.name.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.km - b.km)
      .slice(0, 24);
  });

  nearbyCache.set(key, out);
  return out;
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
