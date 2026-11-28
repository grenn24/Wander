/**
 * The airports a trip can fly between, from data/airports.json
 * (scripts/flights/build-airports.mjs): every airport with scheduled service,
 * by IATA code, with where it is, the city it serves and its IANA zone.
 *
 * Pure functions over an index, so the tests can build one from the file and
 * the routes load it once, on the first request that needs it.
 */

const rad = (d) => (d * Math.PI) / 180;
export function kmBetween(aLat, aLng, bLat, bLng) {
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** { iata, name, city, country, lat, lng, tz, size } from the packed rows. */
export function airportIndex(data) {
  const rows = (data && Array.isArray(data.airports)) ? data.airports : [];
  const list = rows.map(([code, name, city, country, lat, lng, tz, size]) => ({
    code, name, city, country, lat, lng, tz, size,
  }));
  return { list, byCode: new Map(list.map((a) => [a.code, a])) };
}

let loaded = null;
/** The index, read once for the life of the server. */
export function airports() {
  if (!loaded) {
    loaded = import('../data/airports.json')
      .then((m) => airportIndex(m.default || m))
      .catch((e) => { loaded = null; throw e; });
  }
  return loaded;
}

const cleanCode = (v) => String(v || '').trim().toUpperCase();

export function airportOf(index, code) {
  return (index && index.byCode.get(cleanCode(code))) || null;
}

/** Only the codes that are real airports with flights, once each, in order. */
export function knownCodes(index, codes, limit = 4) {
  const seen = new Set();
  return (Array.isArray(codes) ? codes : [codes])
    .map(cleanCode)
    .filter((c) => /^[A-Z]{3}$/.test(c) && index.byCode.has(c) && !seen.has(c) && seen.add(c))
    .slice(0, limit);
}

/**
 * The airports someone living here would fly from.
 *
 * Not simply the nearest: Seletar is closer to most of Singapore than Changi
 * and has a handful of turboprops a day. The large airports within 150 km,
 * closest first (London: Heathrow, Gatwick, Luton); a medium one within 60 km
 * only where there is no large one that close (Inverness, then Aberdeen); and
 * with neither, the nearest large airport within 500 km. The flight search
 * takes several at once and picks the best flight from any of them, and the
 * Account page lets the traveller choose their own (airportsAround).
 */
export function nearestAirports(index, lat, lng, limit = 3) {
  if (!index || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const near = index.list
    .filter((a) => a.size >= 2)
    .map((a) => ({ ...a, km: kmBetween(lat, lng, a.lat, a.lng) }))
    .filter((a) => a.km <= 500)
    .sort((a, b) => a.km - b.km);
  /*
   * The other large airports count only when they are nearly as close as the
   * nearest and in its country: Batam and Johor Bahru are as near Singapore as
   * Heathrow is to London, and nobody living there flies from them; Ibaraki is
   * a large airport an hour past Narita with a few flights a day.
   */
  const first = near.find((a) => a.size === 3 && a.km <= 150);
  const large = first ? near.filter((a) => a.size === 3 && a.country === first.country
    && a.km <= Math.min(150, first.km + 50)).slice(0, limit) : [];
  const out = [...large];
  if (!large.some((a) => a.km <= 60)) {
    out.unshift(...near.filter((a) => a.size === 2 && a.km <= 60).slice(0, 2));
  }
  if (!large.length) {
    const far = near.find((a) => a.size === 3);
    if (far) out.push(far);
  }
  return out.slice(0, limit + 1);
}

/** Airports within reach of a place, for someone choosing which they use. */
export function airportsAround(index, lat, lng, km = 200, limit = 8) {
  if (!index || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  return index.list
    .filter((a) => a.size >= 2)
    .map((a) => ({ ...a, km: kmBetween(lat, lng, a.lat, a.lng) }))
    .filter((a) => a.km <= km)
    .sort((a, b) => (b.size - a.size) || (a.km - b.km))
    .slice(0, limit)
    .sort((a, b) => a.km - b.km);
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Airports for a place named in words, without a map: "SIN", "Singapore",
 * "Reykjavík". The fallback when Google cannot be asked. A code is taken as
 * it is; a city matches the airports that serve it, biggest first.
 */
export function airportsNamed(index, text, limit = 3) {
  if (!index) return [];
  const raw = String(text || '').trim();
  if (/^[A-Za-z]{3}$/.test(raw) && index.byCode.has(raw.toUpperCase())) {
    return [index.byCode.get(raw.toUpperCase())];
  }
  const want = fold(raw.split(',')[0]);
  if (!want) return [];
  const served = index.list.filter((a) => a.size >= 2 && fold(a.city).split(' (')[0] === want);
  const loose = served.length ? served
    : index.list.filter((a) => a.size >= 2 && (` ${fold(a.city)} `.includes(` ${want} `)
      || ` ${fold(a.name)} `.includes(` ${want} `)));
  return loose.slice().sort((a, b) => b.size - a.size).slice(0, limit);
}

/** What a page shows and keeps about an airport. */
export function airportBrief(a) {
  return a ? { code: a.code, name: a.name, city: a.city, country: a.country } : null;
}
