/**
 * Server-side place services, all Google.
 *
 * There is deliberately no fallback provider. One source keeps geocoding, the
 * map and nearby search consistent with each other, and makes a missing key an
 * obvious configuration problem rather than a quietly degraded experience.
 */

import { NEARBY_KINDS, exploreAreas, containsPoint, spreadResults } from './explore.js';
export { NEARBY_KINDS } from './explore.js';

const SEARCH_TEXT = 'https://places.googleapis.com/v1/places:searchText';
const SEARCH_NEARBY = 'https://places.googleapis.com/v1/places:searchNearby';
const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';

const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,'
  + 'places.primaryType,places.primaryTypeDisplayName,'
  + 'places.photos.name,places.photos.authorAttributions';

/**
 * A photograph and who took it.
 *
 * The name alone was enough to draw it, but a place photo on Google belongs
 * to the person who went and stood there — showing it without saying so is
 * both discourteous and against the terms the picture comes under. It is also
 * the only caption these pictures have.
 */
function shot(p) {
  if (!p || !p.name) return null;
  const who = (p.authorAttributions || [])[0] || {};
  return {
    ref: p.name,
    author: who.displayName || '',
    authorUri: who.uri || '',
  };
}

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
    primary_type: p.primaryType || '',
    type_label: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
    place_id: p.id || '',
    photo_ref: (p.photos && p.photos[0] && p.photos[0].name) || '',
    // The field mask already pays for every photo on the place, so carrying
    // the rest of them costs nothing beyond the bytes.
    photos: (p.photos || []).map(shot).filter(Boolean).slice(0, 8),
  };
}

/* -------------------------------------------------------------- details --- */

const DETAILS = 'https://places.googleapis.com/v1/places';

/*
 * Everything the editor wants about a place, in one request.
 *
 * The photographs, the rating and the reviews all live behind the same Place
 * Details call and are billed by the request rather than by the field, so
 * asking for them separately would be paying three times for one answer. The
 * route in front of this caches by place, which is why it can afford to be the
 * fat call.
 */
const DETAIL_FIELDS = [
  'photos.name',
  'photos.authorAttributions',
  'rating',
  'userRatingCount',
  'reviews',
  'googleMapsUri',
  // Contact details. Free to add: billing is at the highest tier any field in
  // the mask belongs to, and reviews already put this call there.
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
].join(',');

/*
 * A stored photo, gone stale.
 *
 * A photo reference is the place and one of its photos —
 * places/{place id}/photos/{photo} — and Google only honours it for a while:
 * every reference stored with a stop stopped working some weeks after it was
 * saved, and the photo route answered with a broken image. The place id in it
 * does not expire, so the place's photos can be asked for again. Only the
 * photo names are asked for, which is the cheapest kind of details request,
 * not the full call above. A place's current lead photo is kept for a few
 * hours, so a trip's twenty stops do not ask twenty times per reader.
 */
export function placeOfPhoto(ref) {
  const m = /^places\/([A-Za-z0-9_-]+)\/photos\/[A-Za-z0-9_-]+$/.exec(ref || '');
  return m ? m[1] : null;
}

const LEAD_KEEP_MS = 6 * 60 * 60 * 1000;
const leads = new Map(); // place id -> { at, name } or a pending promise

export async function leadPhoto(placeId) {
  const hit = leads.get(placeId);
  if (hit && (hit.then || Date.now() - hit.at < LEAD_KEEP_MS)) return hit.then ? hit : hit.name;
  const asking = fetch(`${DETAILS}/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': placesKey(), 'X-Goog-FieldMask': 'photos.name' },
  }).then(async (res) => {
    if (!res.ok) throw await googleFail(res);
    const body = await res.json();
    const name = (body.photos && body.photos[0] && body.photos[0].name) || '';
    leads.set(placeId, { at: Date.now(), name });
    if (leads.size > 500) leads.delete(leads.keys().next().value);
    return name;
  }).catch((e) => { leads.delete(placeId); throw e; });
  leads.set(placeId, asking);
  return asking;
}

export async function placeDetails(placeId) {
  const res = await fetch(`${DETAILS}/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': placesKey(),
      'X-Goog-FieldMask': DETAIL_FIELDS,
    },
  });
  if (!res.ok) throw await googleFail(res);
  const body = await res.json();

  return {
    photos: (body.photos || []).map(shot).filter(Boolean).slice(0, 8),
    rating: typeof body.rating === 'number' ? body.rating : null,
    ratings: body.userRatingCount || 0,
    mapsUri: body.googleMapsUri || '',
    /*
     * Written the way the country writes it, dialled the way the world does.
     * A number shown as 03-3541-9444 is the one on the door; the one a phone
     * can actually ring from abroad has the country code on the front.
     */
    phone: body.nationalPhoneNumber || body.internationalPhoneNumber || '',
    dial: (body.internationalPhoneNumber || body.nationalPhoneNumber || '')
      .replace(/[^\d+]/g, ''),
    website: body.websiteUri || '',
    /*
     * Google requires the author to be named and linked wherever a review is
     * shown, so the name and the profile link travel with the text rather than
     * being optional extras the page can forget to render.
     */
    reviews: (body.reviews || []).slice(0, 5).map((r) => {
      const who = r.authorAttribution || {};
      return {
        id: r.name || `${who.displayName}-${r.publishTime}`,
        rating: typeof r.rating === 'number' ? r.rating : null,
        when: r.relativePublishTimeDescription || '',
        text: ((r.text && r.text.text) || '').slice(0, 1200),
        author: who.displayName || 'A Google user',
        authorUri: who.uri || '',
      };
    }).filter((r) => r.text),
  };
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
      maxResultCount: 5,
    }),
  });
  if (!res.ok) throw await googleFail(res);
  const body = await res.json();
  return (body.places || []).map(shape).filter(Boolean);
}

function normalise(value) {
  return String(value || '').normalize('NFKD').toLowerCase()
    .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function similarity(a, b) {
  const left = normalise(a).replace(/\s+/g, '');
  const right = normalise(b).replace(/\s+/g, '');
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(1, 0.72 + (Math.min(left.length, right.length) / Math.max(left.length, right.length)) * 0.28);
  }
  const pairs = (s) => {
    if (s.length < 2) return new Set([s]);
    return new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
  };
  const one = pairs(left);
  const two = pairs(right);
  let shared = 0;
  one.forEach((pair) => { if (two.has(pair)) shared += 1; });
  return (2 * shared) / (one.size + two.size);
}

function wordOverlap(needle, haystack) {
  const wanted = normalise(needle).split(' ').filter((word) => word.length > 1);
  if (!wanted.length) return 0;
  const found = new Set(normalise(haystack).split(' '));
  return wanted.filter((word) => found.has(word)).length / wanted.length;
}

const CATEGORY_TYPES = {
  food: /restaurant|cafe|bakery|bar|food|meal/,
  lodging: /lodging|hotel|hostel|resort|guest_house/,
  shopping: /store|shop|shopping|market|mall/,
  sightseeing: /tourist|museum|gallery|park|temple|church|mosque|landmark|monument/,
  transport: /airport|station|transit|bus|train|ferry|taxi|car_rental/,
  activity: /spa|gym|sports|amusement|zoo|aquarium|hiking|recreation/,
};

function scoreCandidate(place, item, bias) {
  const nameMatch = Math.max(
    similarity(item.query, place.name),
    similarity(item.title, place.name),
  );
  const destinationMatch = wordOverlap(bias, place.label);
  const queryAddressMatch = wordOverlap(item.query, place.label);
  const typeText = `${place.primary_type} ${place.type_label}`.toLowerCase();
  const categoryPattern = CATEGORY_TYPES[item.category];
  const typeMatch = !categoryPattern || !typeText ? 0.5 : (categoryPattern.test(typeText) ? 1 : 0);
  const score = Math.round(
    nameMatch * 50 + destinationMatch * 25 + typeMatch * 15 + queryAddressMatch * 10,
  );
  return { ...place, score, signals: { nameMatch, destinationMatch, typeMatch } };
}

/** Resolve many at once. Google has no per-second cap, so these go together. */
export async function resolveMany(items, bias) {
  return Promise.all(items.slice(0, 60).map(async (it) => {
    try {
      const candidates = (await resolveOne(it.query, bias))
        .map((place) => scoreCandidate(place, it, bias))
        .sort((a, b) => b.score - a.score);
      const hit = candidates[0];
      if (!hit) return { id: it.id, found: false, candidates: [] };
      const runnerUp = candidates[1];
      const margin = runnerUp ? hit.score - runnerUp.score : hit.score;
      const highConfidence = hit.score >= 72
        && hit.signals.nameMatch >= 0.72
        && hit.signals.destinationMatch >= 0.34
        && (!runnerUp || margin >= 10);
      const slim = (candidate) => {
        const copy = { ...candidate };
        delete copy.photos;
        delete copy.signals;
        return copy;
      };
      return {
        id: it.id,
        ...slim(hit),
        found: true,
        confidence: highConfidence ? 'high' : 'uncertain',
        ambiguous: !highConfidence,
        candidates: candidates.slice(0, 5).map(slim),
      };
    } catch (e) {
      console.error(`[places] resolve "${it.query}":`, explain(e));
      return { id: it.id, found: false, candidates: [] };
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

export async function nearbyPlaces(lat, lng, kind, radius = 900, bounds = null) {
  const config = NEARBY_KINDS.find((k) => k.id === kind);
  if (!config) throw Object.assign(new Error('Choose an explore category.'), { status: 400 });
  const areas = exploreAreas(lat, lng, radius, bounds);
  const groups = await Promise.all(areas.map(async (area) => {
    const res = await fetch(SEARCH_NEARBY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': placesKey(),
        'X-Goog-FieldMask': `${FIELDS},places.rating`,
      },
      body: JSON.stringify({
        includedTypes: config.types,
        maxResultCount: 20,
        rankPreference: area.rank,
        locationRestriction: {
          circle: {
            center: { latitude: area.center.lat, longitude: area.center.lng },
            radius: area.radius,
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
        place_id: s.place_id,
        name: s.name || s.label,
        location: s.label,
        category: config.category,
        kind,
        lat: s.lat,
        lng: s.lng,
        photo_ref: s.photo_ref,
        detail: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '',
        rating: p.rating || null,
        km: haversine(lat, lng, s.lat, s.lng),
      };
    }).filter((p) => p && (!area.bounds || containsPoint(area.bounds, p)));
  }));
  return spreadResults(groups);
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
