/*
 * Every airport with scheduled flights, by its IATA code: where it is, the
 * city it serves, and the clock it keeps.
 *
 * The flight search (lib/flights.js) is told a flight leaves SIN at 23:55 and
 * lands at LHR at 06:10, and nothing about whose 23:55 that is. A flight's
 * times are local to its two airports, and the calendar export, Traveller
 * mode and the itinerary's off-clock marks all need the IANA zone of each end
 * (public/trip-time.js). So the zone comes from here, never from a guess.
 *
 * Two open sources, joined on the IATA code:
 *   OurAirports (public domain): which airports have scheduled service, how
 *     big they are, their names and cities. https://ourairports.com/data/
 *   mwgg/Airports (MIT): each airport's IANA time zone.
 *     https://github.com/mwgg/Airports
 * An airport mwgg has no zone for takes the zone of the nearest one it does
 * (any airport, IATA code or not), which is right everywhere but within a few
 * kilometres of a border.
 *
 * The city is the one a traveller would say they are flying to, which is
 * often not the town the runway is in: Taipei, not Taoyuan; Tokyo, not
 * Narita. OurAirports names the town, mwgg usually the city, and each is
 * wrong where the other is right (mwgg's Sapporo is "Chitose / Tomakomai").
 * So mwgg's city is taken where it is a city OurAirports files another
 * airport within 100 km under (Narita's "Tokyo" is Haneda's), OurAirports'
 * town otherwise, and METRO settles the big airports neither names well.
 *
 * Run it again when either source changes:
 *
 *   curl -L -o ourairports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
 *   curl -L -o mwgg.json https://raw.githubusercontent.com/mwgg/Airports/master/airports.json
 *   node scripts/flights/build-airports.mjs ourairports.csv mwgg.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [csvPath, mwggPath] = process.argv.slice(2);
if (!csvPath || !mwggPath) {
  console.error('Usage: node scripts/flights/build-airports.mjs ourairports.csv mwgg.json');
  process.exit(1);
}
const out = new URL('../../data/airports.json', import.meta.url);

// Heliports and seaplane bases carry IATA codes too, and no one plans a trip
// through one by accident.
const SIZE = { large_airport: 3, medium_airport: 2, small_airport: 1 };

// The airports neither source names by the city they serve.
const METRO = {
  KUL: 'Kuala Lumpur', NGO: 'Nagoya', DPS: 'Bali', IAD: 'Washington', BWI: 'Baltimore',
  EWR: 'New York', IST: 'Istanbul', SAW: 'Istanbul', CTS: 'Sapporo', OKA: 'Okinawa', MXP: 'Milan',
};

/** RFC 4180 CSV, which OurAirports writes: quoted fields may hold commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const rad = (d) => (d * Math.PI) / 180;
function km(aLat, aLng, bLat, bLng) {
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const zones = Object.values(JSON.parse(readFileSync(mwggPath, 'utf8')))
  .filter((a) => a && a.tz && Number.isFinite(a.lat) && Number.isFinite(a.lon));
const zoneByIata = new Map(zones.filter((a) => a.iata).map((a) => [a.iata, a.tz]));

function nearestZone(lat, lng) {
  let best = null;
  let bestKm = Infinity;
  zones.forEach((a) => {
    const d = km(lat, lng, a.lat, a.lon);
    if (d < bestKm) { bestKm = d; best = a.tz; }
  });
  return bestKm < 150 ? best : null;
}

const round = (n) => Math.round(n * 10000) / 10000;
// "Paris (Roissy-en-France, Val-d'Oise)" -> "Paris"; "Chitose / Tomakomai" -> "Chitose"
const base = (v) => String(v || '').split(/\s*[(,/]/)[0].trim();
const cityOfIata = new Map(zones.filter((a) => a.iata).map((a) => [a.iata, base(a.city)]));
let borrowed = 0;
const served = parseCsv(readFileSync(csvPath, 'utf8'))
  .filter((r) => /^[A-Z]{3}$/.test(r.iata_code) && r.scheduled_service === 'yes' && SIZE[r.type])
  .map((r) => ({ ...r, lat: Number(r.latitude_deg), lng: Number(r.longitude_deg), town: base(r.municipality) }));

function cityFor(r) {
  if (METRO[r.iata_code]) return METRO[r.iata_code];
  const city = cityOfIata.get(r.iata_code);
  if (!city || city === r.town) return r.town || city || '';
  const another = served.some((o) => o !== r && SIZE[o.type] >= 2 && o.town === city
    && km(r.lat, r.lng, o.lat, o.lng) <= 100);
  return another ? city : (r.town || city);
}

const airports = served
  .map((r) => {
    let tz = zoneByIata.get(r.iata_code) || null;
    if (!tz) { tz = nearestZone(r.lat, r.lng); if (tz) borrowed += 1; }
    return [r.iata_code, r.name, cityFor(r), r.iso_country, round(r.lat), round(r.lng), tz, SIZE[r.type]];
  })
  .filter((a) => Number.isFinite(a[4]) && Number.isFinite(a[5]) && a[6])
  // One row per code: OurAirports very occasionally lists a closed field
  // beside the new one under the same code, and the bigger is the live one.
  .sort((a, b) => a[0].localeCompare(b[0]) || b[7] - a[7])
  .filter((a, i, all) => i === 0 || all[i - 1][0] !== a[0]);

writeFileSync(out, `${JSON.stringify({
  fields: ['iata', 'name', 'city', 'country', 'lat', 'lng', 'tz', 'size'],
  sizes: { 3: 'large', 2: 'medium', 1: 'small' },
  airports,
})}\n`);
console.log(`${airports.length} airports (${borrowed} with a neighbour's zone) -> data/airports.json`);
