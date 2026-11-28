import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clock24, readHotels, nameMatch, pickHotel, stayWithHotel, nightsBetween, searchHotels,
} from '../lib/hotels.js';
import { staysToLookUp, findRealStays, findRealStaysForEdits } from '../lib/realStays.js';
import { proposeEdits } from '../lib/tripEdits.js';
import { applyChanges, expandAll } from '../lib/tripChanges.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The shape of a SerpApi Google Hotels answer (serpapi.com/google-hotels-api).
const hotel = (name, extra = {}) => ({
  type: 'hotel',
  name,
  property_token: `tok-${name}`,
  gps_coordinates: { latitude: 35.6951, longitude: 139.7016 },
  check_in_time: '3:00 PM',
  check_out_time: '11:00 AM',
  rate_per_night: { lowest: '¥18,000', extracted_lowest: 18000 },
  total_rate: { lowest: '¥54,000', extracted_lowest: 54000 },
  overall_rating: 4.36,
  reviews: 5234,
  extracted_hotel_class: 4,
  prices: [
    { source: 'Booking.com', rate_per_night: { extracted_lowest: 19000 } },
    { source: 'Agoda', rate_per_night: { extracted_lowest: 18000 }, free_cancellation: true, free_cancellation_until_date: 'Dec 1' },
  ],
  ...extra,
});
const ANSWER = { properties: [hotel('Hotel Gracery Shinjuku'), hotel('Shinjuku Granbell Hotel', { overall_rating: 4.5 })] };

/* ---------------------------------------------------------- reading --- */

test('a hotel\'s own clock reads as 24-hour times', () => {
  assert.equal(clock24('3:00 PM'), '15:00');
  assert.equal(clock24('11:00 AM'), '11:00');
  assert.equal(clock24('12 PM'), '12:00');
  assert.equal(clock24('12:30 am'), '00:30');
  assert.equal(clock24('noon'), '');
  assert.equal(clock24(''), '');
});

test('a Google Hotels answer reads as hotels, from a list or one hotel\'s page', () => {
  const [first] = readHotels(ANSWER);
  assert.deepEqual(first, {
    name: 'Hotel Gracery Shinjuku', token: 'tok-Hotel Gracery Shinjuku', lat: 35.6951, lng: 139.7016,
    address: '', check_in_time: '15:00', check_out_time: '11:00', nightly: 18000, total: 54000,
    rating: 4.36, reviews: 5234, stars: 4, cheapest_at: 'Agoda', free_cancel_until: 'Dec 1',
  });
  assert.equal(readHotels(hotel('Park Hyatt Tokyo', { address: '3-7-1-2 Nishishinjuku' }))[0].address, '3-7-1-2 Nishishinjuku');
  assert.deepEqual(readHotels({ properties: [{ type: 'hotel' }] }), [], 'a hotel with no name is left out');
  assert.deepEqual(readHotels(null), []);
  assert.deepEqual(readHotels({ search_metadata: {} }), []);
});

test('the hotel asked for, and never another in its place', () => {
  const hotels = readHotels(ANSWER);
  assert.equal(nameMatch('Stay at Hotel Gracery Shinjuku', 'Hotel Gracery Shinjuku'), 1);
  assert.equal(pickHotel(hotels, 'Hotel Gracery Shinjuku').name, 'Hotel Gracery Shinjuku');
  assert.equal(pickHotel(hotels, 'Gracery Shinjuku').name, 'Hotel Gracery Shinjuku');
  assert.equal(pickHotel(hotels, 'Park Hyatt Tokyo'), null, 'a better-rated hotel nearby is a different stay');
  assert.equal(pickHotel(hotels, 'Hotel'), null, 'a word that names no hotel matches none');
  assert.equal(nightsBetween('2026-12-03', '2026-12-06'), 3);
  assert.equal(nightsBetween('2026-12-06', '2026-12-03'), 0);
});

const stay = (extra = {}) => ({
  day: '2026-12-03', title: 'Hotel Gracery Shinjuku', category: 'lodging',
  location: 'Hotel Gracery Shinjuku, Kabukicho, Shinjuku City, Tokyo',
  details: { check_in_date: '2026-12-03', check_out_date: '2026-12-06' }, notes: 'Godzilla on the roof.', cost: 0,
  ...extra,
});

test('a stay with its real hotel: pinned, timed and priced, its own words kept', () => {
  const [found] = readHotels(ANSWER);
  const real = stayWithHotel(stay(), found, { currency: 'JPY', nights: 3 });
  assert.equal(real.lat, 35.6951);
  assert.deepEqual(real.details, {
    check_in_date: '2026-12-03', check_out_date: '2026-12-06', check_in_time: '15:00', check_out_time: '11:00',
  });
  assert.equal(real.cost, 54000, 'the whole stay, stored once');
  assert.match(real.notes, /About ¥18,000 a night, ¥54,000 for 3 nights for one guest, cheapest on Agoda/);
  assert.match(real.notes, /Free cancellation until Dec 1\./);
  assert.match(real.notes, /Rated 4\.4 from 5,234 reviews\./);
  assert.match(real.notes, /Not booked/);
  assert.match(real.notes, /\nGodzilla on the roof\.$/, 'what was written stays');

  const theirs = stayWithHotel(stay({ cost: 61000, details: { check_in_date: '2026-12-03', check_out_date: '2026-12-06', check_in_time: '18:00' } }),
    found, { currency: 'JPY', nights: 3, booked: true });
  assert.equal(theirs.cost, 61000, 'what they paid is not what Google shows now');
  assert.equal(theirs.details.check_in_time, '18:00', 'their arrival time stands');
  assert.equal(theirs.details.check_out_time, '11:00');
  assert.doesNotMatch(theirs.notes, /Not booked|a night/);
});

/* ---------------------------------------------------------- the service --- */

test('only a hotel with its nights is searched, by name and city', () => {
  const targets = staysToLookUp([
    stay(),
    stay({ details: { check_in_date: '2026-12-03' } }),
    { title: 'Dinner', category: 'food' },
    stay({ title: 'Park Hyatt Tokyo', location: 'Park Hyatt Tokyo, Shinjuku, Tokyo', booking_ref: 'PH-123' }),
  ]);
  assert.deepEqual(targets.map((t) => [t.index, t.query, t.nights, t.booked]), [
    [0, 'Hotel Gracery Shinjuku, Tokyo', 3, false],
    [3, 'Park Hyatt Tokyo', 3, true],
  ]);
});

test('one service makes any entry\'s hotel real, and keeps what it cannot find', async () => {
  const asked = [];
  const search = async (q) => { asked.push(q); return readHotels(ANSWER); };
  const dinner = { title: 'Dinner', category: 'food' };
  const out = await findRealStays([dinner, stay(), stay({ title: 'Nowhere Inn Sapporo' })], { search, currency: 'JPY' });
  assert.deepEqual(out.found, [false, true, false]);
  assert.equal(out.matched, 1);
  assert.equal(out.entries[0], dinner);
  assert.equal(out.entries[1].cost, 54000);
  assert.equal(out.entries[2].title, 'Nowhere Inn Sapporo', 'kept as written for the place check');
  assert.deepEqual(asked.map((q) => [q.query, q.checkIn, q.checkOut, q.currency]), [
    ['Hotel Gracery Shinjuku, Tokyo', '2026-12-03', '2026-12-06', 'JPY'],
    ['Nowhere Inn Sapporo, Tokyo', '2026-12-03', '2026-12-06', 'JPY'],
  ]);
  const was = process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;
  try {
    assert.equal((await findRealStays([stay()])).why, 'no_key');
  } finally {
    if (was !== undefined) process.env.SERPAPI_API_KEY = was;
  }
});

test('the search asks Google Hotels for one guest on those dates', async () => {
  const was = { fetch: globalThis.fetch, key: process.env.SERPAPI_API_KEY };
  let asked;
  process.env.SERPAPI_API_KEY = 'test-key';
  globalThis.fetch = async (url) => { asked = new URL(url); return { ok: true, json: async () => ANSWER }; };
  try {
    const hotels = await searchHotels({ query: 'Hotel Gracery Shinjuku, Tokyo', checkIn: '2026-12-03', checkOut: '2026-12-06', currency: 'GBP', country: 'GB' });
    assert.equal(hotels.length, 2);
    const p = asked.searchParams;
    assert.equal(p.get('engine'), 'google_hotels');
    assert.equal(p.get('q'), 'Hotel Gracery Shinjuku, Tokyo');
    assert.equal(p.get('check_in_date'), '2026-12-03');
    assert.equal(p.get('check_out_date'), '2026-12-06');
    assert.equal(p.get('adults'), '1');
    assert.equal(p.get('currency'), 'GBP');
    assert.equal(p.get('gl'), 'uk');
  } finally {
    globalThis.fetch = was.fetch;
    if (was.key === undefined) delete process.env.SERPAPI_API_KEY; else process.env.SERPAPI_API_KEY = was.key;
  }
});

/* -------------------------------------------------------- the editor --- */

const match = (entries, opts) => findRealStays(entries, { ...opts, search: async () => readHotels(ANSWER) });
const blank = Object.fromEntries(['kind', 'describe', 'activity_id', 'day', 'title', 'start_time', 'end_time',
  'category', 'subtype', 'details', 'location', 'named_place', 'cost', 'notes', 'items'].map((k) => [k, null]));

test('the editor proposes the real hotel: a new stay priced, a moved one re-timed', async () => {
  const trip = { start_date: '2026-12-01', end_date: '2026-12-08', currency: 'JPY' };
  const booked = {
    id: 'h1', day: '2026-12-03', title: 'Hotel Gracery Shinjuku', category: 'lodging', notes: 'Booked on Agoda',
    location: 'Hotel Gracery Shinjuku, Tokyo', details: { check_in_date: '2026-12-03', check_out_date: '2026-12-05' },
  };
  const ops = await findRealStaysForEdits([
    { ...blank, kind: 'add_activity', describe: 'Add a hotel', day: '2026-12-03', title: 'Hotel Gracery Shinjuku', category: 'lodging', location: 'Shinjuku, Tokyo', details: { check_in_date: '2026-12-03', check_out_date: '2026-12-06' } },
    { ...blank, kind: 'update_activity', describe: 'Stay a night longer', activity_id: 'h1', details: { check_out_date: '2026-12-06' } },
    { ...blank, kind: 'delete_activity', describe: 'Delete dinner', activity_id: 'd1' },
  ], { activities: [booked], trip, match });
  assert.equal(ops[0].describe, 'Add Hotel Gracery Shinjuku, 3 nights, about ¥54,000');
  assert.equal(ops[0].cost, 54000);
  assert.equal(ops[0].lat, 35.6951, 'pinned at the hotel');
  assert.equal(ops[0].details.check_in_time, '15:00');
  assert.equal(ops[1].notes, null, 'their notes are theirs');
  assert.equal(ops[1].cost, null, 'a stay already there keeps its price');
  assert.equal(ops[1].details.check_out_date, '2026-12-06');
  assert.equal(ops[1].details.check_out_time, '11:00');
  assert.equal(ops[2].describe, 'Delete dinner');

  // Apply keeps the hotel's pin rather than looking it up again.
  let added = [];
  await applyChanges({
    expanded: expandAll([ops[0]], []), activities: [], trip, api: { addActivities: async (rows) => { added = rows; } },
  });
  assert.equal(added[0].lat, 35.6951);
  assert.equal(added[0].details.check_in_time, '15:00');
});

test('the shared editor checks flights and hotels at the same time', async () => {
  const order = [];
  const out = await proposeEdits({
    instruction: 'Add the Gracery for 3 nights and a flight to Sapporo on the 6th',
    trip: { name: 'Japan', start_date: '2026-12-01', end_date: '2026-12-08', currency: 'JPY' },
    ask: async () => ({
      understood: true,
      question: null,
      summary: 'Add a hotel and a flight',
      ops: [
        { kind: 'add_activity', describe: 'Add a hotel', day: '2026-12-03', title: 'Hotel Gracery Shinjuku', category: 'lodging', location: 'Tokyo', details: { check_in_date: '2026-12-03', check_out_date: '2026-12-06' } },
        { kind: 'add_activity', describe: 'Add a flight', day: '2026-12-06', title: 'Flight to Sapporo', start_time: '10:30', category: 'transport', subtype: 'flight', details: { from: 'HND', to: 'CTS' } },
      ],
    }),
    matchStays: async (entries, opts) => { order.push('stays start'); const r = await match(entries, opts); order.push('stays end'); return r; },
    match: async (drafts) => {
      order.push('flights start');
      await new Promise((done) => { setTimeout(done, 10); });
      order.push('flights end');
      return { groups: drafts.map((d) => [{ ...d, start_time: '11:00', details: { ...d.details, code: 'JL513' }, lat: 35.55, lng: 139.78, location: 'Haneda' }]), found: drafts.map(() => true) };
    },
  });
  assert.deepEqual(order.slice(0, 2).sort(), ['flights start', 'stays start'], 'both asked before either answers');
  assert.equal(out.ops[0].cost, 54000);
  assert.equal(out.ops[1].details.code, 'JL513');
});

/* ------------------------------------------------------------- wiring --- */

test('every way of making entries checks hotels through the same service', () => {
  assert.match(read('app/api/stays/route.js'), /await findRealStays\(rows/);
  const checks = read('lib/entryChecks.js');
  assert.match(checks, /fetchRealStays\(stays\.map\(\(i\) => list\[i\]\), \{ currency \}\)/);
  assert.match(checks, /await Promise\.all\(\[\s*fetchRealFlights[\s\S]*fetchRealStays[\s\S]*fetchExactPlaces/);
  const page = read('app/plan/page.js');
  assert.match(page, /fetchRealStays\(stayRows\.map/);
  assert.match(page, /places\.uncertain\.filter\(\(u\) => !stayed\.has\(String\(u\.id\)\)\)/, 'no question about a hotel already found');
  assert.match(read('app/api/plan/route.js'), /suggest one hotel for each place they sleep/);
  assert.match(read('lib/flights.js'), /from '\.\/serpApi\.js'/, 'one SerpApi client');
  assert.match(read('lib/realFlights.js'), /spendSearches\(userId/, 'one search budget');
  assert.match(read('lib/realStays.js'), /spendSearches\(userId/);
});
