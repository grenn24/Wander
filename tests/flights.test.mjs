import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  airportIndex, airportOf, knownCodes, nearestAirports, airportsNamed, airportsAround,
} from '../lib/airports.js';
import {
  readOffers, pickOffer, offerActivities, placeholderActivity, normaliseCode, searchOffers, duration,
} from '../lib/flights.js';
import {
  cleanFixed, fixedBlock, isHomeFlight, flightTargets, dayIndexOf, fixedFlights,
} from '../lib/flightPlan.js';
import { cleanHome, homeOf, homeName } from '../lib/home.js';
import { validZone, activityTimes } from '../public/trip-time.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const index = airportIndex(JSON.parse(read('data/airports.json')));
const codes = (list) => list.map((a) => a.code);

/* ------------------------------------------------------------- airports --- */

test('every airport has a real IANA zone, a place and a code', () => {
  assert.ok(index.list.length > 3000, 'the table covers the world');
  for (const a of index.list) {
    assert.match(a.code, /^[A-Z]{3}$/);
    assert.ok(validZone(a.tz), `${a.code} ${a.tz}`);
    assert.ok(Math.abs(a.lat) <= 90 && Math.abs(a.lng) <= 180, a.code);
  }
  assert.equal(airportOf(index, 'sin').tz, 'Asia/Singapore');
  assert.equal(airportOf(index, 'HND').tz, 'Asia/Tokyo');
  assert.equal(airportOf(index, 'LHR').tz, 'Europe/London');
  assert.equal(airportOf(index, 'JFK').tz, 'America/New_York');
});

test('a home flies from the airports people there use, not merely the nearest', () => {
  assert.deepEqual(codes(nearestAirports(index, 1.29, 103.85)), ['SIN'], 'not Seletar, Batam or Johor Bahru');
  assert.deepEqual(codes(nearestAirports(index, 51.507, -0.128)), ['LHR', 'LGW', 'LTN']);
  assert.deepEqual(codes(nearestAirports(index, 35.68, 139.76)), ['HND', 'NRT'], 'not Ibaraki');
  assert.deepEqual(codes(nearestAirports(index, 64.15, -21.94)), ['KEF']);
  assert.deepEqual(nearestAirports(index, NaN, 0), []);
  // The others nearby are offered to choose from.
  assert.ok(codes(airportsAround(index, 51.507, -0.128)).includes('STN'));
});

test('airports are found by code or city when there is no map to ask', () => {
  assert.deepEqual(codes(airportsNamed(index, 'sin')), ['SIN']);
  assert.deepEqual(codes(airportsNamed(index, 'Singapore')), ['SIN']);
  assert.ok(codes(airportsNamed(index, 'Osaka')).includes('KIX'));
  assert.ok(codes(airportsNamed(index, 'Reykjavík')).includes('KEF'), 'accents do not matter');
  assert.deepEqual(airportsNamed(index, ''), []);
  assert.deepEqual(knownCodes(index, ['hnd', 'XXX', 'HND', 'nrt', 'Tokyo']), ['HND', 'NRT']);
});

/* --------------------------------------------------- reading the answer --- */

// The shape of a SerpApi Google Flights answer (serpapi.com/google-flights-api).
const leg = (airline, number, from, to, dep, arr, minutes, plane = 'Airbus A350') => ({
  departure_airport: { name: `${from} airport`, id: from, time: dep },
  arrival_airport: { name: `${to} airport`, id: to, time: arr },
  duration: minutes, airplane: plane, airline, flight_number: number, travel_class: 'Economy',
});
const ANSWER = {
  best_flights: [
    {
      flights: [leg('Singapore Airlines', 'SQ 638', 'SIN', 'HND', '2026-12-03 23:45', '2026-12-04 07:40', 415)],
      layovers: [], total_duration: 415, price: 720, type: 'One way',
    },
    {
      flights: [leg('Japan Airlines', 'JL 36', 'SIN', 'HND', '2026-12-03 9:10', '2026-12-03 17:05', 415, 'Boeing 787')],
      layovers: [], total_duration: 415, price: 760, type: 'One way',
    },
  ],
  other_flights: [
    {
      flights: [
        leg('Scoot', 'TR 808', 'SIN', 'TPE', '2026-12-03 06:30', '2026-12-03 11:10', 280),
        leg('Scoot', 'TR 874', 'TPE', 'NRT', '2026-12-03 12:40', '2026-12-03 16:55', 195),
      ],
      layovers: [{ duration: 90, name: 'Taoyuan International Airport', id: 'TPE' }],
      total_duration: 565, price: 410, type: 'One way',
    },
    // Half a journey is not a journey.
    { flights: [{ airline: 'Broken', flight_number: 'XX 1' }], total_duration: 100, price: 1 },
  ],
};

test('a Google Flights answer reads as flights with every leg', () => {
  const offers = readOffers(ANSWER, 'SGD');
  assert.equal(offers.length, 3, 'the unreadable flight is left out');
  const [first, , third] = offers;
  assert.equal(first.best, true);
  assert.deepEqual(first.legs[0], {
    carrier: 'Singapore Airlines', code: 'SQ638', from: 'SIN', to: 'HND',
    from_name: 'SIN airport', to_name: 'HND airport',
    depart_day: '2026-12-03', depart_time: '23:45', arrive_day: '2026-12-04', arrive_time: '07:40',
    minutes: 415, aircraft: 'Airbus A350', cabin: 'Economy', delayed: false,
  });
  assert.equal(offers[1].legs[0].depart_time, '09:10', 'single-digit hours are padded');
  assert.equal(third.stops, 1);
  assert.equal(third.price, 410);
  assert.equal(third.currency, 'SGD');
  assert.deepEqual(readOffers({}), []);
  assert.deepEqual(readOffers(null), []);
});

test('flight numbers are compared without their spaces and zeros', () => {
  assert.equal(normaliseCode('SQ 638'), 'SQ638');
  assert.equal(normaliseCode('sq0638'), 'SQ638');
  assert.equal(normaliseCode('3K 123'), '3K123');
  assert.equal(normaliseCode('SIA638'), 'SIA638');
  assert.equal(normaliseCode('not a flight'), '');
  assert.equal(duration(415), '6h 55m');
  assert.equal(duration(60), '1h');
});

/* ------------------------------------------------------------ choosing --- */

test('the way there leaves in the day and lands the same day', () => {
  const offers = readOffers(ANSWER, 'SGD');
  // Google's own first choice is the red-eye, which throws day 1 away.
  assert.equal(pickOffer(offers, { kind: 'outbound' }).legs[0].code, 'JL36');
});

test('the way home leaves the last day some use', () => {
  const offers = readOffers({
    best_flights: [
      { flights: [leg('ANA', 'NH 841', 'HND', 'SIN', '2026-12-07 07:05', '2026-12-07 13:30', 445)], total_duration: 445, price: 600 },
      { flights: [leg('ANA', 'NH 843', 'HND', 'SIN', '2026-12-07 15:30', '2026-12-07 22:00', 450)], total_duration: 450, price: 640 },
    ],
  }, 'SGD');
  assert.equal(pickOffer(offers, { kind: 'return' }).legs[0].code, 'NH843');
});

test('a flight inside the trip is the real one nearest the planned time', () => {
  const offers = readOffers({
    best_flights: [
      { flights: [leg('ANA', 'NH 59', 'HND', 'CTS', '2026-12-05 07:00', '2026-12-05 08:35', 95)], total_duration: 95, price: 200 },
      { flights: [leg('JAL', 'JL 513', 'HND', 'CTS', '2026-12-05 11:00', '2026-12-05 12:35', 95)], total_duration: 95, price: 210 },
      { flights: [leg('ANA', 'NH 73', 'HND', 'CTS', '2026-12-05 17:00', '2026-12-05 18:35', 95)], total_duration: 95, price: 190 },
    ],
  }, 'JPY');
  assert.equal(pickOffer(offers, { kind: 'hop', near: '10:30' }).legs[0].code, 'JL513');
  assert.equal(pickOffer(offers, { kind: 'hop', near: '18:00' }).legs[0].code, 'NH73');
});

test('a flight the traveller named is that flight or nothing', () => {
  const offers = readOffers(ANSWER, 'SGD');
  assert.equal(pickOffer(offers, { code: 'sq 638' }).legs[0].code, 'SQ638');
  assert.equal(pickOffer(offers, { code: 'TR874' }).stops, 1, 'a leg of a connection counts');
  assert.equal(pickOffer(offers, { code: 'SQ12' }), null, 'never another flight in its place');
  assert.equal(pickOffer([], {}), null);
});

/* ------------------------------------------------------ as activities --- */

test('a chosen flight becomes one activity a leg, with real clocks at each end', () => {
  const offers = readOffers(ANSWER, 'SGD');
  const [row] = offerActivities(offers[1], index, { names: { HND: 'Tokyo' } });
  assert.equal(row.title, 'Flight to Tokyo');
  assert.equal(row.day, '2026-12-03');
  assert.equal(row.start_time, '09:10');
  assert.equal(row.end_time, '17:05');
  assert.equal(row.category, 'transport');
  assert.equal(row.subtype, 'flight');
  assert.deepEqual(row.details, {
    carrier: 'Japan Airlines', code: 'JL36', from: 'SIN', to: 'HND',
    departure_timezone: 'Asia/Singapore', arrival_timezone: 'Asia/Tokyo', arrival_date: '2026-12-03',
    _arrive: { q: 'HND', lat: airportOf(index, 'HND').lat, lng: airportOf(index, 'HND').lng },
  });
  assert.equal(row.location, 'Singapore Changi Airport');
  assert.equal(row.lat, airportOf(index, 'SIN').lat, 'pinned where it departs');
  assert.equal(row.cost, 760);
  assert.match(row.notes, /Nonstop, 6h 55m, Boeing 787\./);
  assert.match(row.notes, /one way in economy/);
  assert.match(row.notes, /Not booked/);
  // The calendar and Traveller mode can place it exactly.
  const at = activityTimes(row, 'Asia/Tokyo');
  assert.equal(at.end - at.start, 415 * 60000);
});

test('a connection is a leg each, with the fare once and the change explained', () => {
  const offers = readOffers(ANSWER, 'SGD');
  const legs = offerActivities(offers[2], index);
  assert.equal(legs.length, 2);
  assert.deepEqual(legs.map((l) => l.details.code), ['TR808', 'TR874']);
  assert.deepEqual(legs.map((l) => l.cost), [410, 0]);
  assert.match(legs[0].notes, /1 stop, changing in Taipei \(1h 30m\)/);
  assert.match(legs[1].notes, /Connects from TR808/);
  assert.equal(legs[1].details.departure_timezone, 'Asia/Taipei');
});

test('the way home ends with a flight home, and a booking is not repriced', () => {
  const offers = readOffers(ANSWER, 'SGD');
  const legs = offerActivities(offers[2], index, { homeward: true, names: { NRT: 'Singapore' } });
  assert.deepEqual(legs.map((l) => l.title), ['Flight to Taipei', 'Flight home to Singapore']);
  assert.equal(offerActivities(offers[1], index, { homeward: true })[0].title, 'Flight home');
  const booked = offerActivities(offers[0], index, { booked: true })[0];
  assert.equal(booked.cost, 0, 'what they paid is not what Google shows now');
  assert.doesNotMatch(booked.notes, /Not booked/);
});

test('with no schedule, a flight still has its airports, day and clocks', () => {
  const row = placeholderActivity(index, { from: 'SIN', to: 'HND', day: '2026-12-03', names: { HND: 'Tokyo' } });
  assert.equal(row.title, 'Flight to Tokyo');
  assert.equal(row.start_time, null);
  assert.equal(row.details.departure_timezone, 'Asia/Singapore');
  assert.equal(row.details.arrival_timezone, 'Asia/Tokyo');
  assert.equal(placeholderActivity(index, { from: 'SIN', to: 'XXX', day: '2026-12-03' }), null);
});

/* ------------------------------------------------------------- the call --- */

test('the search asks Google Flights for one-way flights from every home airport', async () => {
  const was = { fetch: globalThis.fetch, key: process.env.SERPAPI_API_KEY };
  const asked = [];
  process.env.SERPAPI_API_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    asked.push(new URL(url));
    return { ok: true, status: 200, json: async () => ANSWER };
  };
  try {
    const offers = await searchOffers({
      from: ['LHR', 'LGW'], to: ['HND', 'NRT'], date: '2026-12-03', currency: 'GBP', country: 'GB',
    });
    assert.equal(offers.length, 3);
    const p = asked[0].searchParams;
    assert.equal(asked[0].origin + asked[0].pathname, 'https://serpapi.com/search.json');
    assert.equal(p.get('engine'), 'google_flights');
    assert.equal(p.get('type'), '2');
    assert.equal(p.get('departure_id'), 'LHR,LGW');
    assert.equal(p.get('arrival_id'), 'HND,NRT');
    assert.equal(p.get('outbound_date'), '2026-12-03');
    assert.equal(p.get('currency'), 'GBP');
    assert.equal(p.get('gl'), 'uk', "Google's code for the United Kingdom");
    assert.equal(p.get('adults'), '1', 'the fare is for one person');

    globalThis.fetch = async () => ({
      ok: true, status: 200, json: async () => ({ error: "Google Flights hasn't returned any results for this query." }),
    });
    assert.deepEqual(await searchOffers({ from: 'SIN', to: 'HND', date: '2026-12-03' }), [], 'no flights is an answer');
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Invalid API key.' }) });
    await assert.rejects(searchOffers({ from: 'SIN', to: 'HND', date: '2026-12-03' }), /Invalid API key/);

    delete process.env.SERPAPI_API_KEY;
    await assert.rejects(searchOffers({ from: 'SIN', to: 'HND', date: '2026-12-03' }), /SERPAPI_API_KEY/);
  } finally {
    globalThis.fetch = was.fetch;
    if (was.key === undefined) delete process.env.SERPAPI_API_KEY; else process.env.SERPAPI_API_KEY = was.key;
  }
});

/* ------------------------------------------------------- the planner --- */

const offers = readOffers(ANSWER, 'SGD');
const found = [
  { kind: 'outbound', legs: offerActivities(offers[1], index, { names: { HND: 'Tokyo' } }) },
  {
    kind: 'return',
    legs: offerActivities(readOffers({
      best_flights: [{ flights: [leg('ANA', 'NH 843', 'HND', 'SIN', '2026-12-07 15:30', '2026-12-07 22:00', 450)], total_duration: 450, price: 640 }],
    }, 'SGD')[0], index, { homeward: true }),
  },
];
const fixed = cleanFixed({
  start_date: '2026-12-03', duration_days: 5, currency: 'SGD', home: 'Singapore', home_airports: ['SIN'],
  flights: fixedFlights(found),
});

test('the dates and flights the page sends are read carefully', () => {
  assert.equal(fixed.duration_days, 5);
  assert.equal(fixed.flights.length, 2);
  assert.deepEqual(fixed.flights[0].legs[0], {
    day: '2026-12-03', start_time: '09:10', end_time: '17:05', carrier: 'Japan Airlines', code: 'JL36',
    from: 'SIN', to: 'HND', arrival_date: '2026-12-03',
  });
  assert.equal(cleanFixed(null), null);
  assert.equal(cleanFixed({ start_date: 'soon', duration_days: 3 }), null);
  assert.equal(cleanFixed({ start_date: '2026-12-03', duration_days: 400 }).duration_days, 30);
  assert.deepEqual(cleanFixed({ start_date: '2026-12-03', duration_days: 2, flights: [{ legs: [{ day: 'x' }] }] }).flights, []);
  assert.equal(dayIndexOf('2026-12-03', '2026-12-07'), 5);
});

test('the planner is told the flights as facts and not to write them', () => {
  const block = fixedBlock(fixed);
  assert.match(block, /runs from 2026-12-03 for 5 days, so the last day is 2026-12-07/);
  assert.match(block, /Write every cost in SGD/);
  assert.match(block, /do not write them, or any other flight to or from Singapore/);
  assert.match(block, /Day 1, 2026-12-03: Japan Airlines JL36 from SIN at 09:10, landing at HND at 17:05 on 2026-12-03/);
  assert.match(block, /Day 5, 2026-12-07: ANA NH843 from HND at 15:30/);
  assert.equal(fixedBlock(null), '');
});

test('a copy of the flights there and home is dropped; a flight inside the trip is kept', () => {
  const flight = (title, details = {}) => ({ title, category: 'transport', subtype: 'flight', details });
  assert.equal(isHomeFlight(flight('Flight to Tokyo', { from: 'SIN', to: 'HND' }), fixed, 1), true);
  assert.equal(isHomeFlight(flight('Flight to Tokyo'), fixed, 1), true, 'no airports, on the day the app flies');
  assert.equal(isHomeFlight(flight('Flight back to Singapore'), fixed, 5), true);
  assert.equal(isHomeFlight({ title: 'Fly home', category: 'transport', subtype: null, details: {} }, fixed, 5), true);
  assert.equal(isHomeFlight(flight('Flight to Sapporo', { from: 'HND', to: 'CTS' }), fixed, 3), false);
  assert.equal(isHomeFlight({ title: 'Taxi to the airport for your flight', category: 'transport', subtype: 'transfer' }, fixed, 5), false);
  assert.equal(isHomeFlight({ title: 'Dinner', category: 'food' }, fixed, 1), false);
  assert.equal(isHomeFlight(flight('Flight to Tokyo'), null, 1), false, 'without flights found, nothing is dropped');
});

test('only flights between airports are searched, and a named one is trusted', () => {
  const rows = [
    { day: '2026-12-05', category: 'transport', subtype: 'flight', start_time: '10:30', details: { from: 'HND', to: 'CTS' } },
    { day: '2026-12-06', category: 'transport', subtype: 'flight', details: { from: 'CTS', to: 'ITM', code: 'NH 776' } },
    { day: '2026-12-06', category: 'transport', subtype: 'train', details: { from: 'Tokyo', to: 'Kyoto' } },
    { day: '2026-12-06', category: 'transport', subtype: 'flight', details: { from: 'CTS' } },
  ];
  const targets = flightTargets(rows, 'We are on nh776 from Sapporo');
  assert.deepEqual(targets, [
    { id: '0', from: 'HND', to: 'CTS', date: '2026-12-05', near: '10:30', code: '', trusted: false },
    { id: '1', from: 'CTS', to: 'ITM', date: '2026-12-06', near: null, code: 'NH776', trusted: true },
  ]);
  assert.equal(flightTargets(rows, '')[1].trusted, false, 'a number the planner wrote is only a hint');
});

/* ------------------------------------------------------------- the home --- */

test('a home is a place and the airports it flies from', () => {
  assert.deepEqual(cleanHome({ label: 'Singapore', lat: 1.29, lng: 103.85, airports: ['sin', 'SIN', 'bad1'] }),
    { label: 'Singapore', lat: 1.29, lng: 103.85, airports: ['SIN'] });
  assert.equal(cleanHome({ label: 'Nowhere', airports: [] }), null);
  assert.equal(cleanHome('Singapore'), null);
  assert.deepEqual(homeOf({ user_metadata: { home: { label: 'London, UK', airports: ['LHR'] } } }),
    { label: 'London, UK', airports: ['LHR'] });
  assert.equal(homeOf({ user_metadata: {} }), null);
  assert.equal(homeName({ label: 'London, UK' }), 'London');
});

/* ------------------------------------------------------------ the wiring --- */

test('the planner finds the flights before it plans, and keeps the home it was told', () => {
  const page = read('app/plan/page.js');
  assert.match(page, /mode: 'trip', prompt: brief/);
  assert.match(page, /\.\.\.\(fixed \? \{ fixed \} : \{\}\)/, 'every request for the plan, resumes too');
  assert.match(page, /supabase\.auth\.updateUser\(\{ data: \{ home \} \}\)/);
  assert.match(page, /mode: 'legs', items: hops/);
  assert.match(page, /if \(leg\.day > end\) end = leg\.day/, 'a connection home the next day is inside the trip');
  const route = read('app/api/plan/route.js');
  assert.match(route, /fixed = cleanFixed\(body\.fixed\)/);
  assert.match(route, /\$\{fixedBlock\(fixed\)\}/);
  assert.match(route, /!isHomeFlight\(activity, fixed, day\)/);
  assert.match(route, /if \(askOrigin\) questions\.push\(ORIGIN_QUESTION\)/);
  assert.match(route, /details\.from and details\.to are the airports' three-letter IATA codes/);
});
