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

export function fit3DCamera(points, look, aspect = 1) {
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
  const range = clamp(Math.max(height, width / Math.max(0.3, aspect)) * 2.4, 1800, 20000000);
  return { center, range, tilt: range > 150000 ? 25 : 60, heading: 0 };
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
