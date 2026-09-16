/*
 * Where on the globe you have been: the countries, and within them the
 * prefectures, states and provinces, which one each place is in, and the
 * shapes to draw.
 *
 * Filling in a whole country claims too much — a week in Tokyo and Kyoto is
 * not Japan. So what is filled is the areas you actually went to, and the
 * country only gets an outline, which is what still shows you have been
 * there from far enough out that a prefecture is a speck.
 *
 * Countries are Natural Earth's at 1:50 million, by way of world-atlas
 * (public/geo/countries-50m.json). Areas are Natural Earth's first-level
 * divisions at 1:10 million, one simplified file per country
 * (public/geo/areas, built by scripts/geo/build-areas.mjs). Both are TopoJSON,
 * where a border two shapes share is stored once. Nothing here knows about
 * Google or React.
 */
import { km } from './globe.js';

const R = Math.PI / 180;

/*
 * TopoJSON to plain polygons: [[outer, ...holes], ...] of [lng, lat].
 *
 * Borders are "arcs" shared between countries, their points stored as small
 * whole-number steps from the one before. A ring is its arcs joined end to
 * end — an arc numbered ~i is arc i walked backwards — dropping the point
 * each arc repeats from the end of the last.
 */
export function decodeTopology(topology, objectName = 'countries') {
  const t = topology.transform;
  const arcs = topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([a, b]) => {
      if (!t) return [a, b];
      x += a;
      y += b;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    });
  });
  const ring = (indexes) => {
    const out = [];
    indexes.forEach((i, k) => {
      const arc = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      (k ? arc.slice(1) : arc).forEach((p) => out.push(p));
    });
    return out;
  };
  return topology.objects[objectName].geometries
    .filter((g) => g.type === 'Polygon' || g.type === 'MultiPolygon')
    .map((g) => {
      const name = (g.properties && g.properties.name) || '';
      return {
        id: g.id != null ? String(g.id) : name,
        name,
        polygons: (g.type === 'Polygon' ? [g.arcs] : g.arcs).map((poly) => poly.map(ring)),
      };
    });
}

/*
 * A ring cut in two where it crosses the date line.
 *
 * Natural Earth keeps some islands whole across ±180° — part of Fiji, the far
 * east of Russia — so one step of the outline jumps from 179.9° to -179.9°.
 * Draped on a globe that step goes the long way round, and the island becomes
 * a band around the Earth. So the ring is laid out continuously, clipped either
 * side of the line, and the far half moved back into range.
 */
export function splitAtDateLine(ring) {
  const flat = [ring[0]];
  for (let i = 1; i < ring.length; i += 1) {
    let [lng] = ring[i];
    const prev = flat[i - 1][0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    flat.push([lng, ring[i][1]]);
  }
  const lngs = flat.map((p) => p[0]);
  const hi = Math.max(...lngs);
  const lo = Math.min(...lngs);
  // Some rings only touch the line, with a point at 180° and the next at -180°:
  // laid out continuously they need no cut at all.
  if (hi <= 180 && lo >= -180) return [flat];
  const line = hi > 180 ? 180 : -180;
  const west = clip(flat, line, true);
  const east = clip(flat, line, false);
  // The piece beyond the line moves back whole, points on the line included,
  // or it would keep a step from 180° to -179°.
  const pieces = line === 180
    ? [west, east.map(([lng, lat]) => [lng - 360, lat])]
    : [east, west.map(([lng, lat]) => [lng + 360, lat])];
  return pieces.filter((r) => r.length >= 3);
}

// One side of a line of longitude, Sutherland–Hodgman style.
function clip(ring, line, west) {
  const inside = (p) => (west ? p[0] <= line : p[0] >= line);
  const cross = (a, b) => [line, a[1] + ((b[1] - a[1]) * (line - a[0])) / (b[0] - a[0])];
  const out = [];
  ring.forEach((cur, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length];
    if (inside(cur)) {
      if (!inside(prev)) out.push(cross(prev, cur));
      out.push(cur);
    } else if (inside(prev)) {
      out.push(cross(prev, cur));
    }
  });
  return out;
}

/** Area of a ring in square kilometres: planar, which is close enough to rank islands. */
export function ringArea(ring) {
  let a = 0;
  let lat = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    lat += ring[i][1];
  }
  const kmPerDegree = 111.2;
  return Math.abs(a / 2) * Math.cos((lat / ring.length) * R) * kmPerDegree * kmPerDegree;
}

function bboxOf(rings) {
  const b = [180, 90, -180, -90];
  rings.forEach((r) => r.forEach(([lng, lat]) => {
    if (lng < b[0]) b[0] = lng;
    if (lat < b[1]) b[1] = lat;
    if (lng > b[2]) b[2] = lng;
    if (lat > b[3]) b[3] = lat;
  }));
  return b;
}

/** Shapes ready to search and draw: every island a part, cut at the date line, with its size. */
export function prepareShapes(topology, objectName) {
  return decodeTopology(topology, objectName).map((c) => {
    const parts = [];
    c.polygons.forEach(([outer, ...holes]) => {
      const pieces = splitAtDateLine(outer);
      // A hole in an island that crosses the date line is not worth the geometry.
      pieces.forEach((piece) => parts.push({ outer: piece, holes: pieces.length > 1 ? [] : holes }));
    });
    parts.forEach((p) => { p.area = ringArea(p.outer); p.bbox = bboxOf([p.outer]); });
    parts.sort((a, b) => b.area - a.area);
    return { id: c.id, name: c.name, parts, bbox: bboxOf(parts.map((p) => p.outer)) };
  });
}

export const prepareCountries = (topology) => prepareShapes(topology, 'countries');

/** One country's areas from its file, known by the country's code as well as their own. */
export const prepareAreas = (topology, code) => prepareShapes(topology, 'areas')
  .map((a) => ({ ...a, id: `${code}:${a.id}`, country: code }));

/*
 * Which countries' area files a set of places needs. The index lists, for
 * each country, boxes around where its areas lie; a place inside one, give or
 * take a few kilometres of coast, means that file is worth fetching.
 */
export function areaFilesFor(points, index, padDegrees = 0.3) {
  const codes = new Set();
  (points || []).forEach((p) => {
    if (!RANK[p.kind]) return;
    Object.entries(index || {}).forEach(([code, boxes]) => {
      if (boxes.some((b) => inBox([p.lng, p.lat], b, padDegrees))) codes.add(code);
    });
  });
  return [...codes].sort();
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inBox = ([x, y], b, pad = 0) => x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;
const inPart = (pt, part) => inBox(pt, part.bbox) && inRing(pt, part.outer) && !part.holes.some((h) => inRing(pt, h));

/*
 * The shape a place is in, and which of its islands.
 *
 * A town on the coast can fall just offshore: a trip's pin sits at the middle
 * of its stops, and Tokyo with Yokohama averages out into Tokyo Bay, where a
 * simplified coastline has no land. So a place in no shape belongs to the
 * nearest one whose coast is within reach.
 */
export function shapeAt(point, shapes, reachKm = 30) {
  const pt = [point.lng, point.lat];
  for (const c of shapes) {
    if (!inBox(pt, c.bbox)) continue;
    const part = c.parts.find((p) => inPart(pt, p));
    if (part) return { shape: c, part };
  }
  const pad = reachKm / 111.2 / Math.max(0.2, Math.cos(point.lat * R));
  let best = null;
  shapes.forEach((c) => {
    if (!inBox(pt, c.bbox, pad)) return;
    c.parts.forEach((part) => {
      if (!inBox(pt, part.bbox, pad)) return;
      part.outer.forEach(([lng, lat]) => {
        const d = km(point, { lat, lng });
        if (d <= reachKm && (!best || d < best.d)) best = { d, shape: c, part };
      });
    });
  });
  return best ? { shape: best.shape, part: best.part } : null;
}

export function countryAt(point, countries, reachKm = 30) {
  const hit = shapeAt(point, countries, reachKm);
  return hit ? { country: hit.shape, part: hit.part } : null;
}

/*
 * Islands too small to see from where the country is being shown are left
 * out, which takes Canada from 141 shapes to a few dozen. An island stays if it
 * is big, if it is one of the country's three largest, or if you went there:
 * a trip to Okinawa lights up Okinawa, not just Honshu.
 */
const SMALL_ISLAND_KM2 = 1000;

/*
 * Big enough to see from space. A country smaller than this — Singapore, the
 * Maldives, Hong Kong — is a few pixels from orbit, so its places keep their
 * pins at every distance rather than vanishing into a fill no one can see.
 */
const SEEN_FROM_SPACE_KM2 = 20000;

// Areas are small, and their coasts simplified less, so a place needs to be nearer one.
const AREA_REACH_KM = 15;

const RANK = { been: 2, planned: 1 };

function group(into, hit, point) {
  const { shape, part } = hit;
  if (!into.has(shape.id)) into.set(shape.id, { shape, points: [], visited: new Set() });
  const g = into.get(shape.id);
  g.points.push(point);
  g.visited.add(part);
}

const kindOf = (pts) => (pts.some((p) => p.kind === 'been') ? 'been' : 'planned');
const sizeOf = (parts) => parts.reduce((n, p) => n + p.area, 0);

/**
 * What to draw for the places you have been to and are going to.
 *
 * An area region for each prefecture, state or province with one of them in
 * it, filled. A country region for each country, outlined — or filled, for a
 * country whose areas could not be found, so the globe never shows less than
 * it did. Been wins over planned. `size` is the drawn land in km², `covered`
 * the places a country stands in for when the globe is far out.
 */
export function regionsFor(points, countries, areas = []) {
  const byCountry = new Map();
  const byArea = new Map();
  const detailed = new Set(); // countries with at least one place placed in an area
  (points || []).forEach((p) => {
    if (!RANK[p.kind]) return;
    const country = shapeAt(p, countries);
    if (country) group(byCountry, country, p);
    const area = areas.length ? shapeAt(p, areas, AREA_REACH_KM) : null;
    if (area) {
      group(byArea, area, p);
      if (country) detailed.add(country.shape.id);
    }
  });

  const countryRegions = [...byCountry.values()].map(({ shape, points: pts, visited }) => {
    const parts = shape.parts.filter((part, i) => i < 3 || part.area >= SMALL_ISLAND_KM2 || visited.has(part));
    const size = sizeOf(parts);
    return {
      id: `country:${shape.id}`,
      level: 'country',
      filled: !detailed.has(shape.id),
      name: shape.name,
      kind: kindOf(pts),
      points: pts,
      parts,
      size,
      covered: size >= SEEN_FROM_SPACE_KM2 ? pts.map((p) => p.id) : [],
    };
  });

  // A prefecture's far-flung islands — Tokyo's reach a thousand kilometres
  // south — would be specks miles from anywhere you went, so an area draws its
  // main island, anything large, and whichever island you actually visited.
  const areaRegions = [...byArea.values()].map(({ shape, points: pts, visited }) => {
    const parts = shape.parts.filter((part, i) => i === 0 || part.area >= SMALL_ISLAND_KM2 || visited.has(part));
    return {
      id: `area:${shape.id}`,
      level: 'area',
      filled: true,
      name: shape.name,
      kind: kindOf(pts),
      points: pts,
      parts,
      size: sizeOf(parts),
      covered: [],
    };
  });

  return [...countryRegions, ...areaRegions];
}

/*
 * How strongly regions show at a camera distance, 0 to 1, in a few steps.
 *
 * Full from 2,500 km out, where a country is a shape; gone by 700 km, where it
 * is a tint over the whole screen. Stepped rather than smooth, because every
 * change is a repaint of every island, and a flight passes through all of them.
 */
export const REGION_FULL_M = 2500000;
export const REGION_GONE_M = 700000;

const step = (t) => Math.round(Math.max(0, Math.min(1, t)) * 5) / 5;

export function regionStrength(range) {
  return step((range - REGION_GONE_M) / (REGION_FULL_M - REGION_GONE_M));
}

/*
 * How strongly an area shows, from how much of the screen it takes up.
 *
 * A fixed distance cannot suit both Western Australia and Tokyo: the one fills
 * the screen from 3,000 km, the other is still a small shape at 300. So an
 * area is judged by its width against the width of the view — full while it
 * is a shape in the scene, fading as it grows past a third of the screen, gone
 * once you are inside it and it would only tint everything.
 *
 * The view is about 0.6 of the camera's distance across, for the globe's
 * field of view on a landscape screen; near enough to set the thresholds by.
 */
const VIEW_ACROSS = 0.6;
const AREA_FULL = 0.35;
const AREA_GONE = 0.9;

export function areaStrength(sizeKm2, range) {
  const view = (range / 1000) * VIEW_ACROSS;
  const share = Math.sqrt(Math.max(0, sizeKm2)) / Math.max(1, view);
  return step((AREA_GONE - share) / (AREA_GONE - AREA_FULL));
}
