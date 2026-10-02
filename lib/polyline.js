/*
 * Google's encoded polyline format, both ways: Google's routes arrive in it,
 * and the app's own routes are written in it so the same code draws both.
 * Here rather than in lib/geo, which is the browser's, so the server can use it too.
 */

/**
 * Google's encoded polyline, unpacked.
 *
 * Done here rather than by loading Google's geometry library for the one
 * function this app needs from it: the format is a documented run of
 * zigzag-encoded deltas in base64-ish chunks, and it is thirty lines.
 */
export function decodePath(encoded) {
  const out = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < encoded.length) {
    let shift = 0;
    let result = 0;
    let b;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** Google's encoded polyline format, for a path drawn by the same code as Google's routes. */
export function encodePath(points) {
  let out = '';
  let lat = 0;
  let lng = 0;
  const put = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    out += String.fromCharCode(n + 63);
  };
  points.forEach((p) => {
    const a = Math.round(p.lat * 1e5);
    const b = Math.round(p.lng * 1e5);
    put(a - lat); put(b - lng);
    lat = a; lng = b;
  });
  return out;
}
