/**
 * Server-side place services, all Google.
 *
 * There is deliberately no fallback provider. One source keeps geocoding, the
 * map and nearby search consistent with each other, and makes a missing key an
 * obvious configuration problem rather than a quietly degraded experience.
 */

const SEARCH_TEXT = 'https://places.googleapis.com/v1/places:searchText';
const SEARCH_NEARBY = 'https://places.googleapis.com/v1/places:searchNearby';
const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';

const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.photos.name';

function clean(v) {
  const k = v || '';
  return !k || k.startsWith('REPLACE_WITH') ? '' : k;
}

/** Places API (New) — text search, nearby search, place photos. */
export function placesKey() {
  return clean(process.env.PLACES_API_KEY);
}

/**
 * Geocoding API — only used to name a point when you click the map. Falls back
 * to the Places key, so a single server key covers everything if you restrict
 * one key to both APIs rather than splitting them.
 */
export function geocodingKey() {
  return clean(process.env.GEOCODING_API_KEY) || placesKey();
}

export function notConfigured() {
  console.error('[places] PLACES_API_KEY is not set — place lookup is disabled. '
    + 'Set it (and NEXT_PUBLIC_MAPS_JAVASCRIPT_API_KEY for the map) and restart.');
  return Response.json({
    error: 'Place search is switched off right now.',
    code: 'no_key',
  }, { status: 503 });
}

/**
 * Turns a raw fetch failure into something actionable — for the server log.
 * TLS interception is the one that looks like a code bug and is not: a proxy
 * or antivirus re-signs HTTPS with a root that lives in the OS trust store,
 * which Node does not read unless asked. The same machine condition breaks git
 * without `schannel`. None of that belongs in a reply to the browser, so route
 * responses through placesFailure and keep this for the log.
 */
export function explain(e) {
  const code = (e.cause && e.cause.code) || '';
  if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return 'Node could not verify the TLS certificate — something on this machine is '
      + 'intercepting HTTPS. Run the dev server with --use-system-ca (npm run dev does).';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS lookup failed for Google Maps.';
  if (code === 'ECONNREFUSED') return 'Google Maps refused the connection.';
  return `${e.message}${code ? ` [${code}]` : ''}`;
}

/** Log the real cause, hand the browser one plain sentence. */
export function placesFailure(e, where) {
  console.error(`[places] ${where} failed:`, explain(e));
  return Response.json(
    { error: 'Something went wrong on our end. Please try again.' },
    { status: 502 },
  );
}

async function googleFail(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = (body.error && body.error.message) || '';
  } catch (e) { /* non-JSON body */ }
  if (res.status === 403 || /API key/i.test(detail)) {
    return new Error(detail || 'Google rejected the key. Check it is valid and that '
      + 'Places API (New) is enabled on it.');
  }
  return new Error(detail || `Google Maps returned ${res.status}.`);
}

function shape(p) {
  if (!p || !p.location) return null;
  return {
    lat: p.location.latitude,
    lng: p.location.longitude,
    label: p.formattedAddress || (p.displayName && p.displayName.text) || '',
    name: (p.displayName && p.displayName.text) || '',
    place_id: p.id || '',
    photo_ref: (p.photos && p.photos[0] && p.photos[0].name) || '',
    // The field mask already pays for every photo name on the place, so
    // carrying the rest of them costs nothing beyond the bytes.
    photos: (p.photos || []).map((x) => x.name).filter(Boolean).slice(0, 8),
  };
}

/* --------------------------------------------------------------- photos --- */

const DETAILS = 'https://places.googleapis.com/v1/places';

/**
 * Every photo Google holds for one place.
 *
 * A place that was pinned long ago has its id but only the one photo reference
 * that was saved with it, so the rest have to be asked for. One call, cached in
 * the browser for the life of the tab, and only when a photo strip is actually
 * on screen.
 */
export async function placePhotos(placeId) {
  const res = await fetch(`${DETAILS}/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': placesKey(),
      'X-Goog-FieldMask': 'photos.name',
    },
  });
  if (!res.ok) throw await googleFail(res);
  const body = await res.json();
  return (body.photos || []).map((x) => x.name).filter(Boolean).slice(0, 8);
}

/* -------------------------------------------------------------- resolve --- */

async function resolveOne(query, bias) {
  const res = await fetch(SEARCH_TEXT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': placesKey(),
      // Field masks are what the call is billed on — ask for the minimum.
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({
      textQuery: bias ? `${query}, ${bias}` : query,
      maxResultCount: 1,
    }),
  });
  if (!res.ok) throw await googleFail(res);
  const body = await res.json();
  return shape(body.places && body.places[0]);
}

/** Resolve many at once. Google has no per-second cap, so these go together. */
export async function resolveMany(items, bias) {
  return Promise.all(items.slice(0, 60).map(async (it) => {
    try {
      const hit = await resolveOne(it.query, bias);
      return { id: it.id, ...(hit || {}), found: !!hit };
    } catch (e) {
      console.error(`[places] resolve "${it.query}":`, explain(e));
      return { id: it.id, found: false };
    }
  }));
}

/**
 * Free-text search returning several candidates.
 *
 * `near` biases results towards a point rather than restricting to it — a
 * search for "ramen" while looking at Shibuya should prefer Shibuya but still
 * find the famous one two stations away.
 */
export async function searchPlaces(query, limit = 6, near = null) {
  const res = await fetch(SEARCH_TEXT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': placesKey(),
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: Math.min(10, limit),
      ...(near ? {
        locationBias: {
          circle: {
            center: { latitude: near.lat, longitude: near.lng },
            radius: Math.min(50000, Math.max(500, near.radius || 3000)),
          },
        },
      } : {}),
    }),
  });
  if (!res.ok) throw await googleFail(res);
  const body = await res.json();
  return (body.places || []).map(shape).filter(Boolean);
}

/* -------------------------------------------------------------- reverse --- */

export async function reverseGeocode(lat, lng) {
  const url = `${GEOCODE}?latlng=${lat},${lng}&key=${encodeURIComponent(geocodingKey())}`;
  const res = await fetch(url);
  if (!res.ok) throw await googleFail(res);
  const body = await res.json();
  if (body.status === 'REQUEST_DENIED') {
    throw new Error(body.error_message || 'Google denied the geocoding request. '
      + 'Enable the Geocoding API on this key.');
  }
  const first = body.results && body.results[0];
  return {
    label: (first && first.formatted_address) || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    name: (first && first.address_components && first.address_components[0]
      && first.address_components[0].long_name) || '',
    place_id: (first && first.place_id) || '',
  };
}

/* --------------------------------------------------------------- nearby --- */

export const NEARBY_KINDS = [
  { id: 'food', label: 'Food & drink', category: 'food' },
  { id: 'sights', label: 'Sights', category: 'sightseeing' },
  { id: 'transit', label: 'Transit', category: 'transport' },
  { id: 'shops', label: 'Shops', category: 'shopping' },
];

const NEARBY_TYPES = {
  food: ['restaurant', 'cafe', 'bakery', 'bar'],
  sights: ['tourist_attraction', 'museum', 'art_gallery', 'park'],
  transit: ['train_station', 'subway_station', 'bus_station'],
  shops: ['shopping_mall', 'department_store', 'book_store', 'clothing_store'],
};

export async function nearbyPlaces(lat, lng, kind, radius = 900) {
  const types = NEARBY_TYPES[kind];
  if (!types) return [];
  const res = await fetch(SEARCH_NEARBY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': placesKey(),
      'X-Goog-FieldMask': `${FIELDS},places.primaryTypeDisplayName,places.rating`,
    },
    body: JSON.stringify({
      includedTypes: types,
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: Math.min(4000, Math.max(200, radius)),
        },
      },
    }),
  });
  if (!res.ok) throw await googleFail(res);
  const body = await res.json();
  return (body.places || []).map((p) => {
    const s = shape(p);
    if (!s) return null;
    return {
      id: `g-${s.place_id}`,
      name: s.name || s.label,
      kind,
      lat: s.lat,
      lng: s.lng,
      photo_ref: s.photo_ref,
      detail: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
      rating: p.rating || null,
      km: haversine(lat, lng, s.lat, s.lng),
    };
  }).filter(Boolean);
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
