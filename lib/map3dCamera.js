const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (lng) => ((lng + 540) % 360) - 180;
export const validMapPoint = (point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
  && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

// Approximate the same visible ground span when switching renderers. Google
// 3D uses metres from the target, whereas the flat map uses Mercator zoom.
export function zoomToRange(zoom, lat, height = 600) {
  const metresPerPixel = 156543.03392 * Math.max(0.01, Math.cos(lat * Math.PI / 180)) / 2 ** (zoom ?? 14);
  return clamp(metresPerPixel * (height || 600) / (2 * Math.tan(35 * Math.PI / 360)), 150, 20000000);
}

export function rangeToZoom(range, lat, height = 600) {
  const metresPerPixel = Math.max(1, range) * 2 * Math.tan(35 * Math.PI / 360) / Math.max(1, height || 600);
  return clamp(Math.log2(156543.03392 * Math.max(0.01, Math.cos(lat * Math.PI / 180)) / metresPerPixel), 2, 21);
}

// The margin a fit keeps from the edges of what can be seen of the map.
export const FIT_MARGIN = 48;

/**
 * Padding for fitting stops into the part of a `width` x `height` map that
 * can be seen. `cover` says how far the controls over the map reach in from
 * each edge, in pixels ({ top, right, bottom, left }): the day chips along the
 * top, the stops panel down the side. A fit that ignores them frames its stops
 * right out to the edges of the whole map, and on a wide window the one at
 * the far side sits under the panel. Null when too little would be left to
 * fit into (a phone with its sheet pulled up): then the whole map is used.
 */
export function coverPadding(width, height, cover, margin = FIT_MARGIN) {
  const edge = (side) => margin + Math.max(0, Number(cover?.[side]) || 0);
  const pad = { top: edge('top'), right: edge('right'), bottom: edge('bottom'), left: edge('left') };
  return width - pad.left - pad.right >= 160 && height - pad.top - pad.bottom >= 160 ? pad : null;
}

/**
 * Where to centre the flat map at `zoom` so that `point` shows in the middle
 * of what `pad` leaves ({ top, right, bottom, left }, px): beside the panel
 * rather than under it. Worked out on Google's own Web Mercator world, 256
 * pixels across at zoom 0, rather than from where a fit left the map — a fit
 * of one stop asks for more zoom than the map has, and the map, cutting it
 * back, keeps the centre it worked out for the zoom it did not get.
 */
export function centreBeside(point, zoom, pad) {
  const size = 256 * 2 ** zoom;
  const sin = Math.sin(clamp(point.lat, -85, 85) * Math.PI / 180);
  const x = ((point.lng + 180) / 360) * size + (pad.right - pad.left) / 2;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size + (pad.bottom - pad.top) / 2;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / size));
  return { lat, lng: wrap((x / size) * 360 - 180) };
}

/**
 * The 3D camera that frames `points`, or looks at `look` when there are none.
 * `frame`, when given, is the map's size and how far the controls over it
 * reach in from each edge ({ width, height, top, right, bottom, left }, px):
 * the stops are framed in the part of the map that can be seen, as on the
 * flat map (see coverPadding), and `aspect` is taken from it.
 */
export function fit3DCamera(points, look, aspect = 1, frame = null) {
  const valid = (points || []).filter(validMapPoint);
  if (!valid.length) return { center: validMapPoint(look) ? { lat: look.lat, lng: look.lng } : { lat: 35.68, lng: 139.76 }, range: 5000, tilt: 60, heading: 0 };
  // Use the complement of the largest longitude gap, so an itinerary crossing
  // the date line stays near the Pacific rather than centring on Greenwich.
  const lngs = valid.map((p) => (p.lng + 360) % 360).sort((a, b) => a - b);
  let gap = -1, start = lngs[0];
  lngs.forEach((lng, i) => {
    const next = i + 1 < lngs.length ? lngs[i + 1] : lngs[0] + 360;
    if (next - lng > gap) { gap = next - lng; start = next % 360; }
  });
  const span = 360 - gap;
  const north = Math.max(...valid.map((p) => p.lat));
  const south = Math.min(...valid.map((p) => p.lat));
  const center = { lat: (north + south) / 2, lng: wrap(start + span / 2) };
  const width = span * 111320 * Math.max(0.01, Math.cos(center.lat * Math.PI / 180));
  const height = (north - south) * 111320;
  const pad = frame ? coverPadding(frame.width, frame.height, frame, 0) : null;
  if (!pad) {
    const range = clamp(Math.max(height, width / Math.max(0.3, aspect)) * 2.4, 1800, 20000000);
    return { center, range, tilt: range > 150000 ? 25 : 60, heading: 0 };
  }
  // The same framing, but into the open part of the map: as much closer as it is smaller.
  const open = { width: frame.width - pad.left - pad.right, height: frame.height - pad.top - pad.bottom };
  const range = clamp(Math.max(height / open.height, width / open.width) * frame.height * 2.4, 1800, 20000000);
  const tilt = range > 150000 ? 25 : 60;
  /*
   * And moved so the stops sit in the middle of it: the camera goes the other
   * way from the open part's middle, by that many pixels of ground where the
   * camera looks. Up the screen is north (the heading is 0), and ground runs
   * away from a tilted camera, so each pixel up the screen is more of it.
   */
  const perPixel = (2 * Math.tan(35 * Math.PI / 360) * range) / frame.height;
  const east = ((pad.right - pad.left) / 2) * perPixel;
  const northward = (((pad.top - pad.bottom) / 2) * perPixel) / Math.cos(tilt * Math.PI / 180);
  return {
    center: {
      lat: clamp(center.lat + northward / 111320, -89, 89),
      lng: wrap(center.lng + east / (111320 * Math.max(0.01, Math.cos(center.lat * Math.PI / 180)))),
    },
    range, tilt, heading: 0,
  };
}

export function viewport3D(center, range) {
  if (!validMapPoint(center)) return null;
  const radius = Math.round(clamp(range * 0.55, 300, 50000));
  const latSpan = radius / 111320;
  const lngSpan = Math.min(180, latSpan / Math.max(0.01, Math.cos(center.lat * Math.PI / 180)));
  return { lat: center.lat, lng: center.lng, radius, spanKm: radius / 1000,
    bounds: { north: clamp(center.lat + latSpan, -90, 90), south: clamp(center.lat - latSpan, -90, 90),
      east: wrap(center.lng + lngSpan), west: wrap(center.lng - lngSpan) } };
}
