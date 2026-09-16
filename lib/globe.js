/*
 * The globe's arithmetic: which pins exist, where they sit, and where the
 * camera should be to look at them.
 *
 * Nothing here knows about Google or React, so it can be tested with node.
 */

import { imageURL } from './journeyFormat.js';

const R = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function km(a, b) {
  const h = Math.sin((b.lat - a.lat) * R / 2) ** 2
    + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lng - a.lng) * R / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** Mean position on the sphere, so points either side of the date line average sensibly. */
export function centroid(points) {
  let x = 0; let y = 0; let z = 0;
  points.forEach((p) => {
    x += Math.cos(p.lat * R) * Math.cos(p.lng * R);
    y += Math.cos(p.lat * R) * Math.sin(p.lng * R);
    z += Math.sin(p.lat * R);
  });
  const n = points.length || 1;
  x /= n; y /= n; z /= n;
  return { lat: Math.atan2(z, Math.hypot(x, y)) / R, lng: Math.atan2(y, x) / R };
}

/** Greedy clustering: good enough for a few hundred stops, and stable in input order. */
export function cluster(points, radiusKm) {
  const groups = [];
  points.forEach((p) => {
    const home = groups.find((g) => km(g, p) <= radiusKm);
    if (!home) { groups.push({ lat: p.lat, lng: p.lng, items: [p] }); return; }
    home.items.push(p);
    const c = centroid(home.items);
    home.lat = c.lat; home.lng = c.lng;
  });
  return groups;
}

/**
 * The town an address is in, from Google's formatted address.
 *
 * "Senso-ji, 2 Chome-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan" is Tokyo:
 * drop the country, then postcodes, bare numbers and US state codes, and what
 * is left at the end is the town.
 */
export function townOf(address) {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return '';
  const tidy = parts.slice(0, -1)
    .map((s) => s.replace(/\s+\d[\d-]{2,}$/, '').replace(/^\d[\d-]{2,}\s+/, '').trim())
    .filter((s) => s && !/^[\d\s-]+$/.test(s) && !/^[A-Z]{2}(\s+\d{4,5}(-\d{4})?)?$/.test(s));
  const town = tidy[tidy.length - 1] || '';
  return /\d/.test(town) ? '' : town;
}

function mostCommon(words) {
  const n = new Map();
  words.filter(Boolean).forEach((w) => n.set(w, (n.get(w) || 0) + 1));
  let best = ''; let top = 0;
  n.forEach((count, w) => { if (count > top) { best = w; top = count; } });
  return best;
}

/*
 * What to search for when none of a town's stops has a photograph: its most
 * photogenic stop, by the kind of stop it is, with its address. "Fushimi
 * Inari, Fushimi Ward, Kyoto" finds the shrine gates; "Kyoto" alone finds
 * whatever Google thinks of first.
 */
const PHOTOGENIC = ['sightseeing', 'activity', 'food', 'lodging'];

export function photoQueryOf(items) {
  const rank = (a) => {
    const i = PHOTOGENIC.indexOf(a.category);
    return i < 0 ? PHOTOGENIC.length : i;
  };
  const best = (items || []).filter((a) => a.title).sort((a, b) => rank(a) - rank(b))[0];
  return best ? [best.title, best.location].filter(Boolean).join(', ') : null;
}

/**
 * Pins for trips: one per place a trip actually went, rather than one per trip.
 *
 * A fortnight across Tokyo and Kyoto is two places on a globe. Transport is
 * left out — the flight's departure airport is home, not somewhere visited.
 */
export function tripPoints(trips, activities, today) {
  const byTrip = new Map();
  (activities || []).forEach((a) => {
    if (!valid(a) || a.category === 'transport') return;
    if (!byTrip.has(a.trip_id)) byTrip.set(a.trip_id, []);
    byTrip.get(a.trip_id).push(a);
  });
  const out = [];
  (trips || []).forEach((t) => {
    const acts = byTrip.get(t.id);
    if (!acts || !acts.length) return;
    const end = t.end_date && t.end_date >= (t.start_date || '') ? t.end_date : t.start_date;
    const kind = end && end < today ? 'been' : 'planned';
    const groups = cluster(acts, 60).sort((a, b) => b.items.length - a.items.length);
    groups.forEach((g, i) => {
      const town = mostCommon(g.items.map((a) => townOf(a.location)));
      const photo = g.items.find((a) => a.photo_ref);
      out.push({
        id: `trip:${t.id}:${i}`,
        kind,
        lat: g.lat,
        lng: g.lng,
        name: town || (groups.length === 1 ? t.destination : '') || t.name,
        tripId: t.id,
        trip: { id: t.id, name: t.name, start_date: t.start_date, end_date: t.end_date },
        stops: g.items.length,
        photo_ref: (photo && photo.photo_ref) || t.cover_ref || null,
        photo_query: photo || t.cover_ref ? null : photoQueryOf(g.items),
      });
    });
  });
  return out;
}

export function savedPoints(rows) {
  return (rows || []).filter(valid).map((r) => ({
    id: `saved:${r.id}`,
    kind: r.kind === 'been' ? 'been' : 'want',
    lat: r.lat,
    lng: r.lng,
    name: r.name,
    label: r.label || '',
    savedId: r.id,
    journey: r.journey || null,
    photo_ref: r.photo_ref || null,
  }));
}

/** Journeys as ideas, except the ones already saved. */
export function ideaPoints(journeys, saved) {
  const cover = (j) => (j.cover && j.cover.raw ? imageURL(j.cover, 680) : null);
  const taken = new Set((saved || []).map((r) => r.journey).filter(Boolean));
  return (journeys || []).filter((j) => valid(j.center) && !taken.has(j.slug)).map((j) => ({
    id: `idea:${j.slug}`,
    kind: 'idea',
    lat: j.center.lat,
    lng: j.center.lng,
    name: j.title,
    label: j.place === j.country ? j.country : `${j.place}, ${j.country}`,
    journey: j.slug,
    photo_ref: j.cover_ref || null,
    image: cover(j),
    // The cover again, marker-sized.
    thumb: j.cover && j.cover.raw ? imageURL(j.cover, 160) : null,
    spots: Array.isArray(j.spots) ? j.spots.filter(valid) : [],
  }));
}

/**
 * Far enough out to be a globe, turned to face the places that are yours.
 * Ideas only steer the camera when there is nothing of your own yet.
 */
export function overviewCamera(points) {
  const own = (points || []).filter((p) => p.kind !== 'idea' && valid(p));
  const use = own.length ? own : (points || []).filter(valid);
  if (!use.length) return { center: { lat: 22, lng: 100 }, range: 20000000, tilt: 0, heading: 0 };
  const c = centroid(use);
  const spread = Math.max(0, ...use.map((p) => km(c, p)));
  return {
    // Looking straight down at a pole makes a globe read as a disc.
    center: { lat: clamp(c.lat, -45, 55), lng: c.lng },
    // Never closer than the whole Earth: nearer than about 17,000 km the
    // edges of the globe leave the screen and it stops reading as one.
    range: clamp(17000000 + spread * 700, 17000000, 25000000),
    tilt: 0,
    heading: 0,
  };
}

/*
 * How close to go for one pin: a town for a trip's town, and for a journey,
 * near enough to see all of its stops — Kyoto with Nara is a city and its
 * neighbour, the Ring Road is all of Iceland. A journey whose stops are not
 * known falls back to a region.
 */
export function focusCamera(point) {
  if (point.kind === 'idea' && (point.spots || []).length > 1) return { ...groupCamera(point.spots), tilt: 20 };
  const range = point.kind === 'idea' ? 900000 : point.tripId ? 45000 : 160000;
  return {
    center: { lat: point.lat, lng: point.lng },
    range,
    tilt: point.kind === 'idea' ? 20 : 45,
    heading: 0,
  };
}

/** Close enough to see every pin in a group — all the towns on one trip. */
export function groupCamera(points) {
  const use = (points || []).filter(valid);
  if (!use.length) return overviewCamera([]);
  if (use.length === 1) return focusCamera(use[0]);
  const c = centroid(use);
  const spread = Math.max(...use.map((p) => km(c, p)));
  return { center: c, range: clamp(spread * 1000 * 3.2, 60000, 6000000), tilt: 30, heading: 0 };
}

/** Longer for further, but never a wait: 1.2 to 4 seconds. */
export function flightMillis(from, to) {
  if (!from || !valid(from.center) || !valid(to.center)) return 0;
  const distance = km(from.center, to.center);
  const zoom = Math.abs(Math.log2(Math.max(1, to.range) / Math.max(1, from.range)));
  return Math.round(clamp(900 + distance * 0.22 + zoom * 160, 1200, 4000));
}

export function globeCounts(points) {
  const trips = (kind) => new Set(points.filter((p) => p.kind === kind && p.tripId).map((p) => p.tripId)).size;
  return {
    been: points.filter((p) => p.kind === 'been').length,
    planned: points.filter((p) => p.kind === 'planned').length,
    want: points.filter((p) => p.kind === 'want').length,
    beenTrips: trips('been'),
    plannedTrips: trips('planned'),
  };
}
