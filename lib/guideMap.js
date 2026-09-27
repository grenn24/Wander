/*
 * A guide as a route, for the map that follows the reader down the journal:
 * which places each section visits, the order the reader meets them in, and
 * how far in to zoom to show a handful of them.
 *
 * Pure, so the page and the tests share it.
 */
const TOKEN = /\{(p\d+)\}/g;
const textsOf = (b) => [b.text, b.title, ...(b.items || []).map((it) => it.text)].filter(Boolean);
const hasPoint = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** A section starts at a heading, or at a paragraph carrying a section label. */
export const startsSection = (b) => b.type === 'heading' || (b.type === 'prose' && !!b.kicker);

/**
 * The journal's sections in order, each with where it starts, its label and
 * title, and the places it mentions in the order they first appear.
 */
export function sectionsOf(blocks) {
  const out = [];
  (blocks || []).forEach((b, i) => {
    if (startsSection(b) || !out.length) {
      let kicker = startsSection(b) ? b.kicker || '' : '';
      let title = b.type === 'heading' ? b.text || '' : '';
      if (b.type === 'prose' && b.kicker) {
        const [when, ...where] = b.kicker.split(' · ');
        kicker = where.length ? when : '';
        title = where.length ? where.join(' · ') : when;
      }
      out.push({ start: i, kicker, title, places: [] });
    }
    const current = out[out.length - 1];
    textsOf(b).forEach((t) => {
      for (const [, id] of t.matchAll(TOKEN)) if (!current.places.includes(id)) current.places.push(id);
    });
  });
  return out;
}

/**
 * The stops a reader passes through, in the order the journal first names
 * them, keeping only places with a position on the map.
 */
export function routeOf(doc) {
  const byId = new Map((doc.places || []).filter(hasPoint).map((p) => [p.id, p]));
  const seen = new Set();
  const stops = [];
  sectionsOf(doc.blocks).forEach((sec, section) => sec.places.forEach((id) => {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    const p = byId.get(id);
    stops.push({ id, name: p.name, lat: p.lat, lng: p.lng, section, place_id: p.place_id || null });
  }));
  return stops;
}

export function boundsOf(points) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) };
}

/**
 * The zoom at which a box fits a map of this many pixels, as Google's own
 * fitBounds would choose it, but known in advance so the camera can glide
 * there instead of jumping.
 */
export function fitZoom(b, width, height, { pad = 56, max = 12, min = 2 } = {}) {
  const mercator = (lat) => {
    const sin = Math.sin((lat * Math.PI) / 180);
    const r = Math.log((1 + sin) / (1 - sin)) / 2;
    return Math.max(Math.min(r, Math.PI), -Math.PI) / 2;
  };
  const latFraction = (mercator(b.north) - mercator(b.south)) / Math.PI;
  const lngSpan = b.east - b.west;
  const lngFraction = (lngSpan < 0 ? lngSpan + 360 : lngSpan) / 360;
  const fit = (px, fraction) => (fraction > 0 ? Math.log2(Math.max(1, px - pad * 2) / 256 / fraction) : Infinity);
  const zoom = Math.min(fit(height, latFraction), fit(width, lngFraction), max);
  return Math.max(min, zoom);
}

/** A point part of the way from one stop to the next. */
export function pointAlong(a, b, t) {
  const k = Math.min(1, Math.max(0, t));
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
}

/** Roughly how far apart two points are, in kilometres. */
export function spanKm(a, b) {
  const x = ((b.lng - a.lng) * Math.PI / 180) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const y = (b.lat - a.lat) * Math.PI / 180;
  return Math.sqrt(x * x + y * y) * 6371;
}
