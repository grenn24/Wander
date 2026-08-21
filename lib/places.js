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

export function googleKey() {
  const k = process.env.GOOGLE_MAPS_SERVER_KEY || '';
  return !k || k.startsWith('REPLACE_WITH') ? '' : k;
}

export function notConfigured() {
  return Response.json({
    error: 'Google Maps is not configured. Set GOOGLE_MAPS_SERVER_KEY (and '
      + 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY for the map itself) and restart the server.',
    code: 'no_key',
  }, { status: 503 });
}

/**
 * Turns a raw fetch failure into something actionable. TLS interception is the
 * one that looks like a code bug and is not: a proxy or antivirus re-signs
 * HTTPS with a root that lives in the OS trust store, which Node does not read
 * unless asked. The same machine condition breaks git without `schannel`.
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
  };
}

/* -------------------------------------------------------------- resolve --- */

async function resolveOne(query, bias) {
  const res = await fetch(SEARCH_TEXT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleKey(),
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
      return { id: it.id, found: false, error: explain(e) };
    }
  }));
}

/** Free-text search returning several candidates, for the activity editor. */
export async function searchPlaces(query, limit = 6) {
  const res = await fetch(SEARCH_TEXT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleKey(),
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: Math.min(10, limit) }),
  });
  if (!res.ok) throw await googleFail(res);
  const body = await res.json();
  return (body.places || []).map(shape).filter(Boolean);
}

/* -------------------------------------------------------------- reverse --- */

export async function reverseGeocode(lat, lng) {
  const url = `${GEOCODE}?latlng=${lat},${lng}&key=${encodeURIComponent(googleKey())}`;
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
      'X-Goog-Api-Key': googleKey(),
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
