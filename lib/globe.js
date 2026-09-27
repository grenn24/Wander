/*
 * The globe's arithmetic: which pins exist, where they sit, and where the
 * camera should be to look at them.
 *
 * Nothing here knows about Google or React, so it can be tested with node.
 */

import { imageURL } from './guideFormat.js';

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
 * A trip in `favourites` (a set of trip ids) marks all of its towns.
 */
export function tripPoints(trips, activities, today, favourites = new Set()) {
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
    // Finished trips are completed ('been'); the rest, dated or not yet, are upcoming ('planned').
    const end = t.end_date && t.end_date >= (t.start_date || '') ? t.end_date : t.start_date;
    const kind = end && end < today ? 'been' : 'planned';
    const favourite = favourites.has(t.id);
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
        favourite,
        trip: { id: t.id, name: t.name, start_date: t.start_date, end_date: t.end_date },
        stops: g.items.length,
        photo_ref: (photo && photo.photo_ref) || t.cover_ref || null,
        photo_query: photo || t.cover_ref ? null : photoQueryOf(g.items),
      });
    });
  });
  return out;
}

/*
 * A trip's stops in the order they happen: by day, then time, then the order
 * they were put in within the day. Each carries its number along the route
 * and which day of the trip it falls on, counted from 0, so the route can be
 * coloured day by day. Transport is left out, as it is from the towns: a
 * flight's position is an airport, not a stop.
 */
export function tripRoute(activities) {
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  // '~' sorts after every date and time, so undated stops come last.
  const stops = (activities || []).filter((a) => valid(a) && a.category !== 'transport')
    .sort((a, b) => cmp(a.day || '~', b.day || '~')
      || cmp(a.start_time || '~', b.start_time || '~')
      || (a.sort_order || 0) - (b.sort_order || 0));
  const days = [...new Set(stops.map((a) => a.day || '~'))];
  return stops.map((a, i) => ({
    n: i + 1,
    id: a.id || null,
    name: a.title || '',
    lat: a.lat,
    lng: a.lng,
    section: days.indexOf(a.day || '~'),
    day: a.day || null,
    time: a.start_time ? String(a.start_time).slice(0, 5) : '',
    location: a.location || '',
    category: a.category || '',
    photo_ref: a.photo_ref || null,
    place_id: a.place_id || null,
  }));
}

/*
 * A route as legs to draw, one per day or section. Each leg begins where the
 * one before ended, so the line runs unbroken from the first stop to the last
 * and changes colour where a new day begins.
 */
export function routeLegs(stops) {
  const legs = [];
  (stops || []).forEach((stop, i) => {
    const leg = legs[legs.length - 1];
    if (leg && leg.section === stop.section) { leg.points.push(stop); return; }
    legs.push({ section: stop.section, points: i ? [stops[i - 1], stop] : [stop] });
  });
  return legs.filter((l) => l.points.length > 1);
}

/** The stops within reach of one of the trip's towns: the part of the route a town marker stands for. */
export function stopsNear(stops, point, radiusKm = 60) {
  return (stops || []).filter((s) => km(s, point) <= radiusKm);
}

/*
 * Places saved as been — somewhere from before Wander, or outside it. Places
 * once saved as want to go are not shown: favourites replaced want to go, and
 * a favourite is a trip or a guide.
 */
export function savedPoints(rows) {
  return (rows || []).filter((r) => valid(r) && r.kind === 'been').map((r) => ({
    id: `saved:${r.id}`,
    kind: 'been',
    lat: r.lat,
    lng: r.lng,
    name: r.name,
    label: r.label || '',
    savedId: r.id,
    guide: r.guide || null,
    photo_ref: r.photo_ref || null,
  }));
}

/** Guides: favourites if their slug is in `favourites`, ideas otherwise. */
export function ideaPoints(guides, favourites = new Set()) {
  const cover = (j) => (j.cover && j.cover.raw ? imageURL(j.cover, 680) : null);
  return (guides || []).filter((j) => valid(j.center)).map((j) => ({
    id: `guide:${j.slug}`,
    kind: favourites.has(j.slug) ? 'favourite' : 'idea',
    favourite: favourites.has(j.slug),
    lat: j.center.lat,
    lng: j.center.lng,
    name: j.title,
    label: j.place === j.country ? j.country : `${j.place}, ${j.country}`,
    guide: j.slug,
    photo_ref: j.cover_ref || null,
    image: cover(j),
    // The cover again, marker-sized.
    thumb: j.cover && j.cover.raw ? imageURL(j.cover, 160) : null,
    spots: Array.isArray(j.spots) ? j.spots.filter(valid) : [],
  }));
}

/**
 * The same view, aimed so the place lands in the part of the globe nothing
 * covers. On a phone an open trip's card is a sheet across the foot of the
 * screen, and a camera aimed at the middle puts the trip's markers behind it.
 *
 * `insets` is how far the cards reach in from the top and foot of the canvas,
 * in pixels, and `height` is the canvas. The camera moves the other way from
 * the middle of what is left: up the screen is the way the camera faces, and
 * ground runs away from a tilted one, so each pixel is more of it.
 */
export function offsetCamera(camera, insets, height) {
  const top = Math.max(0, (insets && insets.top) || 0);
  const foot = Math.max(0, (insets && insets.bottom) || 0);
  if (!camera || !height || (!top && !foot) || height - top - foot < 120) return camera;
  const perPixel = (2 * Math.tan(35 * Math.PI / 360) * camera.range) / height;
  const tilt = ((camera.tilt || 0) * Math.PI) / 180;
  const metres = (((top - foot) / 2) * perPixel) / Math.max(0.2, Math.cos(tilt));
  const heading = ((camera.heading || 0) * Math.PI) / 180;
  const lat = clamp(camera.center.lat + (metres * Math.cos(heading)) / 111320, -85, 85);
  const east = (metres * Math.sin(heading)) / (111320 * Math.max(0.02, Math.cos((lat * Math.PI) / 180)));
  return { ...camera, center: { ...camera.center, lat, lng: ((camera.center.lng + east + 540) % 360) - 180 } };
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
 * How close to go for one pin: a town for a trip's town, and for a guide,
 * near enough to see all of its stops — Kyoto with Nara is a city and its
 * neighbour, the Ring Road is all of Iceland. A guide whose stops are not
 * known falls back to a region.
 */
export function focusCamera(point) {
  const guide = !!point.guide && !point.savedId;
  if (guide && (point.spots || []).length > 1) return { ...groupCamera(point.spots), tilt: 20 };
  const range = guide ? 900000 : point.tripId ? 45000 : 160000;
  return {
    center: { lat: point.lat, lng: point.lng },
    range,
    tilt: guide ? 20 : 45,
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

/*
 * Aiming at the ground, not at sea level.
 *
 * The 3D camera looks at a point with a height, and a place given without one
 * is taken to be at sea level. For Tokyo that is the ground. Fujiyoshida is
 * 800 m up, so the point is 800 m under the town, and a camera tilted to 55°
 * looking at it sees the hillside a kilometre short of it: the stop you chose
 * ends up off the top of the screen. There is no way to ask the map how high
 * the ground is, but once it has stopped it says where its view meets the
 * ground and how high that is. So a view is aimed at the best height known,
 * checked when it lands, and moved in by what it missed.
 */

// Only close views need it: 1 km short of a town seen from 45 km is not a miss.
export const GROUNDED_RANGE = 20000;

/** How far past the target the view's centre landed, in metres along the way the camera faces. */
export function groundOffset(target, seen, heading = 0) {
  const north = (seen.lat - target.lat) * 111320;
  const east = (seen.lng - target.lng) * 111320 * Math.cos(target.lat * R);
  return north * Math.cos(heading * R) + east * Math.sin(heading * R);
}

// The most one correction may change the height aimed at: more than any slope under a close view.
const GROUND_STEP_M = 1500;

/**
 * The height to aim at next, from the aims so far: [{ alt, off }], each the
 * height tried and the offset it landed at. Level ground is assumed, where
 * aiming h metres too high lands h·tan(tilt) beyond.
 *
 * Two tries that landed either side of the target bracket the ground's height,
 * and the slope between them finds it, which on a hillside is what stops the
 * view rocking to and fro. Two on the same side say nothing reliable about the
 * slope — while terrain is still loading they can differ by a few metres, and
 * following the line through them once aimed 1,300 m underground and dived the
 * view into a forest 2 km short. So the slope is only ever interpolated, never
 * extended, and no step moves the aim further than any real slope could need.
 */
export function nextGroundAltitude(tries, tilt) {
  const last = tries[tries.length - 1];
  let next = last.alt - last.off / Math.tan(clamp(tilt, 5, 85) * R);
  if (tries.length > 1) {
    const prev = tries[tries.length - 2];
    if (Math.sign(last.off) !== Math.sign(prev.off) && Math.abs(last.off - prev.off) > 1) {
      next = last.alt - (last.off * (last.alt - prev.alt)) / (last.off - prev.off);
    }
  }
  next = clamp(next, last.alt - GROUND_STEP_M, last.alt + GROUND_STEP_M);
  return clamp(next, -450, 8900);
}

/** The ground height known nearest a place, within a few kilometres of it; sea level otherwise. */
export function groundNear(samples, point, withinKm = 4) {
  let best = null;
  (samples || []).forEach((s) => {
    const d = km(s, point);
    if (d <= withinKm && (!best || d < best.d)) best = { d, alt: s.alt };
  });
  return best ? best.alt : 0;
}

/** Longer for further, but never a wait: 1.2 to 4 seconds. */
export function flightMillis(from, to) {
  if (!from || !valid(from.center) || !valid(to.center)) return 0;
  const distance = km(from.center, to.center);
  const zoom = Math.abs(Math.log2(Math.max(1, to.range) / Math.max(1, from.range)));
  return Math.round(clamp(900 + distance * 0.22 + zoom * 160, 1200, 4000));
}

/*
 * The panel's counts, in the things its lists show: trips, places and
 * guides, not towns. A fortnight in Tokyo and Kyoto is one completed trip,
 * however many towns it put on the globe.
 */
export function globeCounts(points) {
  const trips = (keep) => new Set(points.filter((p) => p.tripId && keep(p)).map((p) => p.tripId)).size;
  return {
    been: trips((p) => p.kind === 'been') + points.filter((p) => p.savedId && p.kind === 'been').length,
    planned: trips((p) => p.kind === 'planned'),
    favourite: trips((p) => p.favourite) + points.filter((p) => !p.tripId && p.kind === 'favourite').length,
  };
}
