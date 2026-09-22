/*
 * Stops that would be drawn on top of each other, gathered into one marker.
 *
 * A week in Tokyo puts a dozen stops inside a few streets, and at the zoom that
 * shows the whole week their pins pile up: numbers under numbers, and the ones
 * underneath cannot be read or tapped. So at each zoom, pins whose circles
 * would overlap on the screen become a single cluster that says how many stops
 * it holds, and tapping it zooms in until they come apart.
 *
 * Measured in screen pixels: on the flat map at its zoom, with Google's own
 * Web Mercator projection; on the 3D map through its camera (projectToScreen).
 * Nothing here knows about Google or the DOM, so it can be tested with node.
 */

const TILE = 256;

/** A point's position in pixels on the whole world's map at this zoom. */
export function worldPixel(lat, lng, zoom) {
  const scale = TILE * 2 ** zoom;
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

// How far a cluster marker reaches from its middle, in pixels: its 34 px circle,
// and the second circle stacked 4 px up and to the right behind it.
export const CLUSTER_RADIUS = 21;

/**
 * Gathers overlapping units at a zoom, on the flat map.
 *
 *   units   [{ key, lat, lng, radius, weight, alone }] — a unit is one pin, or
 *           a fan of pins sharing a spot; `radius` is how far it reaches on the
 *           screen, `weight` how many stops it is, and `alone` keeps it out of
 *           every cluster (the stop you have chosen stays in sight)
 *   gap     how close two circles may come, in pixels, before they merge
 *
 * Returns [{ keys, lat, lng, weight }] in the order of the first unit in each;
 * a group with more than one key is a cluster. Groups merge until no two
 * overlap, each drawn at the weighted middle of its stops, so a cluster that
 * has grown never ends up sitting on a neighbour.
 */
export function clusterUnits(units, zoom, gap = 6) {
  return clusterScreen(
    (units || []).map((u) => ({ ...u, ...worldPixel(u.lat, u.lng, zoom) })),
    gap,
    (lat, lng) => worldPixel(lat, lng, zoom),
  );
}

/**
 * The same, for units already placed on the screen: each also has `x` and `y`
 * in pixels.
 *
 * `place(lat, lng)` puts a point on the same screen. A cluster is drawn at the
 * middle of its stops on the ground, and that is where its overlaps are judged
 * from. On a tilted 3D view that is not the middle of where its stops appear:
 * the far one is squeezed by perspective, so a cluster judged at the on-screen
 * middle was drawn somewhere else, and settled on a pin it had been judged
 * clear of. Without `place`, the on-screen middle is used.
 */
export function clusterScreen(units, gap = 6, place = null) {
  const groups = (units || []).map((u, order) => {
    const weight = Math.max(1, u.weight || 1);
    return {
      order, keys: [u.key], x: u.x, y: u.y, radius: u.radius, weight, alone: !!u.alone,
      lat: u.lat * weight, lng: u.lng * weight,
    };
  });
  for (;;) {
    let best = null;
    for (let i = 0; i < groups.length; i += 1) {
      if (groups[i].alone) continue;
      for (let j = i + 1; j < groups.length; j += 1) {
        if (groups[j].alone) continue;
        const d = Math.hypot(groups[i].x - groups[j].x, groups[i].y - groups[j].y);
        const reach = groups[i].radius + groups[j].radius + gap;
        if (d < reach && (!best || d / reach < best.closeness)) best = { i, j, closeness: d / reach };
      }
    }
    if (!best) break;
    // The closest pair first, so a tight knot gathers before a loose one reaches for it.
    const a = groups[best.i];
    const b = groups[best.j];
    const weight = a.weight + b.weight;
    const drawn = place && place((a.lat + b.lat) / weight, (a.lng + b.lng) / weight);
    groups[best.i] = {
      order: Math.min(a.order, b.order),
      keys: a.order <= b.order ? [...a.keys, ...b.keys] : [...b.keys, ...a.keys],
      x: drawn ? drawn.x : (a.x * a.weight + b.x * b.weight) / weight,
      y: drawn ? drawn.y : (a.y * a.weight + b.y * b.weight) / weight,
      radius: CLUSTER_RADIUS,
      weight,
      alone: false,
      lat: a.lat + b.lat,
      lng: a.lng + b.lng,
    };
    groups.splice(best.j, 1);
  }
  return groups
    .sort((p, q) => p.order - q.order)
    .map((g) => ({ keys: g.keys, lat: g.lat / g.weight, lng: g.lng / g.weight, weight: g.weight }));
}

/*
 * Where a place is drawn by Google's 3D map, from its camera alone.
 *
 * The camera is the map's own: it looks at `center` (with its altitude) from
 * `range` metres away, tilted from straight down and turned from north, with a
 * vertical field of view of 35° unless the map says otherwise. Worked on a
 * sphere rather than a flat sheet, so it still holds when the view takes in a
 * whole trip across a country; checked against markers on the live map to
 * within a pixel.
 *
 * The map describes one camera in several ways. After its own flights the
 * centre is on the ground; after a scroll or a drag it can be a point 7 km in
 * the air seen from 0 m, or a point 7 km underground seen from 15 km. Only the
 * eye — the centre, backed off along the view by the range — is the same in
 * every one, so that is what is worked from, and a place is put at the height
 * it is given (`point.altitude`), never at the centre's.
 *
 * Returns { x, y } in pixels from the map's top-left corner, or null for a
 * place behind the camera.
 */
/*
 * How far the drawn map sits from the worked-out one, from markers already on
 * it: [{ expected: { x, y }, actual: { x, y } }]. The map's description of its
 * camera can put its centre a few hundred metres off the ground for a while
 * after a gesture, which moves every worked-out point by the same 25–30 px;
 * where the markers are actually drawn is the truth. The middle shift of all
 * of them, so a marker that has not been drawn yet cannot throw it; nothing
 * until there are at least two to go by.
 */
export function screenDrift(samples) {
  const good = (samples || []).filter((s) => s && s.expected && s.actual
    && Number.isFinite(s.actual.x) && Number.isFinite(s.actual.y)
    && Math.hypot(s.actual.x - s.expected.x, s.actual.y - s.expected.y) < 200);
  if (good.length < 2) return { dx: 0, dy: 0 };
  const middle = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const m = sorted.length >> 1;
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  };
  return {
    dx: middle(good.map((s) => s.actual.x - s.expected.x)),
    dy: middle(good.map((s) => s.actual.y - s.expected.y)),
  };
}

const EARTH_M = 6371008.8;
const RAD = Math.PI / 180;

function onSphere(lat, lng, altitude) {
  const r = EARTH_M + altitude;
  return [
    r * Math.cos(lat * RAD) * Math.cos(lng * RAD),
    r * Math.cos(lat * RAD) * Math.sin(lng * RAD),
    r * Math.sin(lat * RAD),
  ];
}

export function projectToScreen(cam, point, width, height, fov = 35) {
  const lat = cam.lat * RAD;
  const lng = cam.lng * RAD;
  const east = [-Math.sin(lng), Math.cos(lng), 0];
  const north = [-Math.sin(lat) * Math.cos(lng), -Math.sin(lat) * Math.sin(lng), Math.cos(lat)];
  const up = [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
  const local = (e, n, u) => [0, 1, 2].map((i) => e * east[i] + n * north[i] + u * up[i]);
  const t = (cam.tilt || 0) * RAD;
  const h = (cam.heading || 0) * RAD;
  const forward = local(Math.sin(t) * Math.sin(h), Math.sin(t) * Math.cos(h), -Math.cos(t));
  const right = local(Math.cos(h), -Math.sin(h), 0);
  const camUp = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const altitude = cam.altitude || 0;
  const middle = onSphere(cam.lat, cam.lng, altitude);
  const eye = middle.map((m, i) => m - cam.range * forward[i]);
  const at = onSphere(point.lat, point.lng, Number.isFinite(point.altitude) ? point.altitude : altitude);
  const v = at.map((a, i) => a - eye[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const depth = dot(v, forward);
  if (depth <= 1) return null;
  const scale = (height / 2) / (depth * Math.tan((fov / 2) * RAD));
  return { x: width / 2 + dot(v, right) * scale, y: height / 2 - dot(v, camUp) * scale };
}
