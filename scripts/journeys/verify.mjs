/*
 * Every place checked against Google Maps before anyone reads about it.
 *
 * A model can describe a café that closed two years ago in convincing detail.
 * Google knows whether it is still there, where it is, and what it is called,
 * so each place is looked up, matched on name and distance, and given its
 * place ID — the one piece of Google data that may be kept indefinitely.
 */
const SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus';
const FAR_KM = 1500;

function key() {
  const k = process.env.PLACES_API_KEY || '';
  if (!k || k.startsWith('REPLACE_WITH')) throw new Error('PLACES_API_KEY is not set.');
  return k;
}

const norm = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Words that say what kind of place something is, not which one: sharing
// "lake" does not make Lake Agnes Tea House the town of Lake Louise.
const FILLER = new Set([
  'the', 'and', 'of', 'de', 'da', 'la', 'le', 'du', 'del', 'di',
  'lake', 'park', 'national', 'station', 'street', 'road', 'beach', 'river', 'mount', 'mountain',
  'museum', 'temple', 'shrine', 'church', 'market', 'bridge', 'falls', 'house', 'hotel', 'city',
  'village', 'valley', 'trail', 'track', 'view', 'viewpoint', 'garden', 'gardens', 'palace', 'square',
]);

function dice(a, b) {
  const grams = (s) => {
    const g = new Map();
    for (let i = 0; i < s.length - 1; i += 1) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) || 0) + 1);
    return g;
  };
  const A = grams(a);
  const B = grams(b);
  let shared = 0;
  let total = 0;
  A.forEach((n, k) => { shared += Math.min(n, B.get(k) || 0); total += n; });
  B.forEach((n) => { total += n; });
  return total ? (2 * shared) / total : 0;
}

/*
 * How alike two names are, from 0 to 1.
 *
 * Google often knows a place by another name than the one a traveller uses —
 * Kasugataisha Shrine, Kapellbrücke, Saqsaywaman — so spacing is ignored,
 * shared words count, and spelling that is merely close still scores.
 */
export function nameMatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  const xs = x.replace(/ /g, '');
  const ys = y.replace(/ /g, '');
  if (xs.includes(ys) || ys.includes(xs)) return 1;
  const A = new Set(x.split(' ').filter((w) => w.length > 2 && !FILLER.has(w)));
  const B = y.split(' ').filter((w) => w.length > 2 && !FILLER.has(w));
  const overlap = A.size && B.length ? B.filter((w) => A.has(w)).length / Math.min(A.size, B.length) : 0;
  return Math.max(overlap, dice(xs, ys));
}

export function km(a, b) {
  const R = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * R / 2) ** 2
    + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lng - a.lng) * R / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

async function search(q, center) {
  const res = await fetch(SEARCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key(), 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({
      textQuery: q,
      maxResultCount: 3,
      languageCode: 'en',
      ...(center ? { locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: 50000 } } } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body.error && body.error.message) || `Google returned ${res.status}`);
  }
  const body = await res.json();
  return (body.places || []).filter((p) => p.location).map((p) => ({
    id: p.id,
    name: (p.displayName && p.displayName.text) || '',
    address: p.formattedAddress || '',
    lat: p.location.latitude,
    lng: p.location.longitude,
    status: p.businessStatus || 'OPERATIONAL',
  }));
}

/**
 * Resolve every place. Returns the journey with place IDs and coordinates
 * filled in, and the problems found, in the same shape the review uses.
 *
 * Places already resolved are left alone unless `recheck` — a revision should
 * not pay to look up the ten places it did not touch, but a refresh exists to
 * notice that one of them has closed.
 */
export async function verifyPlaces(doc, { recheck = false } = {}) {
  const issues = [];
  const places = [];
  for (const p of doc.places) {
    if (p.place_id && !recheck) { places.push(p); continue; }
    let hits = [];
    try {
      hits = await search(p.q, doc.center);
    } catch (e) {
      issues.push({ severity: 'minor', area: 'places', where: p.id, problem: `Could not check ${p.name}: ${e.message}`, fix: 'Check again later.' });
      places.push(p);
      continue;
    }
    const scored = hits.map((h) => ({
      ...h,
      // The query often carries the local name ("Kapellbrucke Lucerne") when
      // the display name is the English one ("Chapel Bridge").
      match: Math.max(nameMatch(p.name, h.name), nameMatch(p.q, h.name)),
      km: km(doc.center, h),
    }))
      .sort((a, b) => (b.match - a.match) || (a.km - b.km));
    const best = scored[0];
    if (!best) {
      issues.push({ severity: 'blocking', area: 'places', where: p.id, problem: `Google Maps finds nothing for "${p.q}" (${p.name}).`, fix: 'Replace it with a place Google Maps can find, or give an exact query.' });
      places.push({ ...p, place_id: null });
      continue;
    }
    // A different name is a question for the review, which can search and knows
    // that Tetsugaku no Michi is the Philosopher's Path; it is not a verdict.
    if (best.match < 0.5) {
      issues.push({ severity: 'minor', area: 'places', where: p.id, problem: `"${p.q}" finds "${best.name}" (${best.address}). Check that this is ${p.name} and not somewhere else.`, fix: 'If it is a different place, correct the name or the query so they point at the same place.' });
    }
    if (best.km > FAR_KM) {
      issues.push({ severity: 'blocking', area: 'places', where: p.id, problem: `${p.name} resolves to ${best.address}, ${Math.round(best.km)} km from the journey's centre.`, fix: 'Use the right place, or correct the journey’s centre.' });
    }
    if (best.status === 'CLOSED_PERMANENTLY') {
      issues.push({ severity: 'blocking', area: 'accuracy', where: p.id, problem: `${p.name} is permanently closed according to Google.`, fix: 'Remove it or replace it.' });
    } else if (best.status === 'CLOSED_TEMPORARILY') {
      issues.push({ severity: 'minor', area: 'accuracy', where: p.id, problem: `${p.name} is marked temporarily closed on Google.`, fix: 'Say so, or suggest an alternative.' });
    }
    places.push({
      ...p,
      place_id: best.id,
      lat: best.lat,
      lng: best.lng,
      address: best.address,
      google_name: best.name,
      google_status: best.status,
    });
  }
  return { doc: { ...doc, places }, issues };
}
