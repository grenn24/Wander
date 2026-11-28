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
  cleanFixed, fixedBlock, isHomeFlight, dayIndexOf, fixedFlights,
} from '../lib/flightPlan.js';
import { flightsToLookUp, findRealFlights, findRealFlightsForEdits } from '../lib/realFlights.js';
import { placesToLookUp, applyChanges, expandAll } from '../lib/tripChanges.js';
import { proposeEdits } from '../lib/tripEdits.js';
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
  const targets = flightsToLookUp(rows, 'We are on nh776 from Sapporo');
  assert.deepEqual(targets, [
    { index: 0, from: 'HND', to: 'CTS', date: '2026-12-05', near: '10:30', kind: 'hop', code: '', trusted: false },
    { index: 1, from: 'CTS', to: 'ITM', date: '2026-12-06', near: null, kind: 'hop', code: 'NH776', trusted: true },
  ]);
  assert.equal(flightsToLookUp(rows, '')[1].trusted, false, 'a number the planner wrote is only a hint');
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

/* ------------------------------------------------ the shared service --- */

// Japan's domestic day: a search that answers for HND to CTS, and a
// connection for HND to OKA by way of Fukuoka.
const DOMESTIC = {
  'HND>CTS': {
    best_flights: [
      { flights: [leg('ANA', 'NH 59', 'HND', 'CTS', '2026-12-05 07:00', '2026-12-05 08:35', 95)], total_duration: 95, price: 20000 },
      { flights: [leg('JAL', 'JL 513', 'HND', 'CTS', '2026-12-05 11:00', '2026-12-05 12:35', 95)], total_duration: 95, price: 21000 },
      { flights: [leg('ANA', 'NH 73', 'HND', 'CTS', '2026-12-05 17:00', '2026-12-05 18:35', 95)], total_duration: 95, price: 19000 },
    ],
  },
  'HND>OKA': {
    best_flights: [{
      flights: [
        leg('JAL', 'JL 305', 'HND', 'FUK', '2026-12-05 08:00', '2026-12-05 10:00', 120),
        leg('JAL', 'JL 3561', 'FUK', 'OKA', '2026-12-05 11:30', '2026-12-05 13:15', 105),
      ],
      layovers: [{ duration: 90, name: 'Fukuoka Airport', id: 'FUK' }],
      total_duration: 315,
      price: 30000,
    }],
  },
};
function fakeSearch(asked = []) {
  return async ({ from, to, date }) => {
    asked.push(`${from.join(',')}>${to.join(',')} ${date}`);
    return readOffers(DOMESTIC[`${from[0]}>${to[0]}`] || {}, 'JPY');
  };
}
const flightDraft = (extra = {}) => ({
  day: '2026-12-05', title: 'Flight to Sapporo', start_time: '10:30', end_time: '12:00',
  category: 'transport', subtype: 'flight', details: { from: 'HND', to: 'CTS' }, notes: 'A guess.', cost: 0,
  ...extra,
});

test('one service makes any entry\'s flight real, leaving everything else alone', async () => {
  const asked = [];
  const dinner = { day: '2026-12-05', title: 'Dinner', category: 'food' };
  const { groups, found, matched } = await findRealFlights([dinner, flightDraft()], {
    search: fakeSearch(asked), index, currency: 'JPY',
  });
  assert.equal(matched, 1);
  assert.deepEqual(found, [false, true]);
  assert.deepEqual(groups[0], [dinner]);
  const [real] = groups[1];
  assert.equal(real.details.code, 'JL513', 'the real flight nearest 10:30');
  assert.equal(real.start_time, '11:00');
  assert.equal(real.details.arrival_timezone, 'Asia/Tokyo');
  assert.equal(real.title, 'Flight to Sapporo', 'the title they had stays on the leg that gets there');
  assert.equal(real.cost, 21000);
  assert.deepEqual(asked, ['HND>CTS 2026-12-05'], 'one search, and none for dinner');
  // Nothing to search for asks nothing.
  const none = await findRealFlights([dinner], { search: async () => { throw new Error('asked'); }, index });
  assert.deepEqual(none.groups, [[dinner]]);
});

test('a connection is every leg, and a named flight that does not fly is kept as written', async () => {
  const { groups } = await findRealFlights([flightDraft({ title: 'Flight to Okinawa', details: { from: 'HND', to: 'OKA' } })], {
    search: fakeSearch(), index,
  });
  assert.deepEqual(groups[0].map((l) => [l.title, l.details.code]),
    [['Flight to Fukuoka', 'JL305'], ['Flight to Okinawa', 'JL3561']]);
  assert.deepEqual(groups[0].map((l) => l.cost), [30000, 0]);

  const theirs = flightDraft({ details: { from: 'HND', to: 'CTS', code: 'NH 999' } });
  const kept = await findRealFlights([theirs], { search: fakeSearch(), index, said: 'we fly NH999 to Sapporo' });
  assert.deepEqual(kept.found, [false]);
  const [[same]] = kept.groups;
  assert.equal(same.details.code, 'NH 999', 'never another flight in place of theirs');
  assert.equal(same.start_time, '10:30');
  // Still pinned where it leaves and given its clocks, so it needs no place lookup.
  assert.equal(same.lat, airportOf(index, 'HND').lat);
  assert.equal(same.details.departure_timezone, 'Asia/Tokyo');

  // The planner's hints steer the search and are never saved.
  const asked = [];
  const way = await findRealFlights([flightDraft({ _from: ['HND', 'NRT'], _to: ['CTS'], _kind: 'outbound' })], {
    search: fakeSearch(asked), index,
  });
  assert.deepEqual(asked, ['HND,NRT>CTS 2026-12-05']);
  assert.ok(!Object.keys(way.groups[0][0]).some((k) => k.startsWith('_') && k !== '_arrive'));
});

test('the editor proposes the real flight: a new one, a moved one, a connection', async () => {
  const blank = Object.fromEntries(['kind', 'describe', 'activity_id', 'day', 'title', 'start_time',
    'end_time', 'category', 'subtype', 'details', 'location', 'named_place', 'cost', 'notes', 'items']
    .map((k) => [k, null]));
  const trip = { start_date: '2026-12-03', end_date: '2026-12-08', currency: 'JPY' };
  const booked = {
    id: 'f1', day: '2026-12-05', title: 'Flight to Sapporo', start_time: '07:00', end_time: '08:35',
    category: 'transport', subtype: 'flight', notes: 'Seat 3A, booked.',
    details: { from: 'HND', to: 'CTS', code: 'NH59', carrier: 'ANA', seat: '3A' },
  };
  const match = (drafts, opts) => findRealFlights(drafts, { ...opts, search: fakeSearch(), index });
  const ops = await findRealFlightsForEdits([
    { ...blank, kind: 'add_activity', describe: 'Add a flight to Sapporo at 10:30', day: '2026-12-05', title: 'Flight to Sapporo', start_time: '10:30', category: 'transport', subtype: 'flight', details: { from: 'HND', to: 'OKA' } },
    { ...blank, kind: 'update_activity', describe: 'Move the Sapporo flight to the evening', activity_id: 'f1', start_time: '17:30' },
    { ...blank, kind: 'delete_activity', describe: 'Delete dinner', activity_id: 'd1' },
  ], { activities: [booked], trip, said: 'add a flight to okinawa and move my sapporo flight to the evening', match });

  assert.deepEqual(ops.map((o) => [o.kind, o.describe]), [
    ['add_activity', 'Add JL305, HND 8am to FUK 10am'],
    ['add_activity', 'Add JL3561, FUK 11:30am to OKA 1:15pm'],
    ['update_activity', 'Change to NH73, HND 5pm to CTS 6:35pm'],
    ['delete_activity', 'Delete dinner'],
  ]);
  const [first, , moved] = ops;
  assert.equal(first.lat, airportOf(index, 'HND').lat, 'pinned at its airport');
  assert.equal(first.details.departure_timezone, 'Asia/Tokyo');
  assert.equal(first.details._arrive, undefined, 'the trip page finds the arrival pin');
  assert.equal(moved.notes, null, 'their notes are theirs');
  assert.equal(moved.details.code, 'NH73', 'a new time is another flight');

  // Moving only the day keeps their flight: that number on the new day.
  const dayOnly = await findRealFlightsForEdits([{ ...blank, kind: 'update_activity', describe: 'Move it', activity_id: 'f1', day: '2026-12-05' }],
    { activities: [booked], trip, said: 'move my flight', match });
  assert.equal(dayOnly[0].details.code, 'NH59');
  assert.equal(dayOnly[0].start_time, '07:00');
});

test('the shared editor hands both the command bar and the Assistant real flights', async () => {
  let told = '';
  const out = await proposeEdits({
    instruction: 'Add a flight to Sapporo on the 5th around 10:30',
    trip: { name: 'Japan', start_date: '2026-12-03', end_date: '2026-12-08', currency: 'JPY' },
    home: { label: 'Singapore', airports: ['SIN'] },
    ask: async (req) => {
      told = req.user;
      return {
        understood: true,
        question: null,
        summary: 'Add a flight',
        ops: [{ kind: 'add_activity', describe: 'Add a flight to Sapporo', day: '2026-12-05', title: 'Flight to Sapporo', start_time: '10:30', category: 'transport', subtype: 'flight', details: { from: 'HND', to: 'CTS' } }],
      };
    },
    match: (drafts, opts) => findRealFlights(drafts, { ...opts, search: fakeSearch(), index }),
  });
  assert.match(told, /Their home: Singapore, flying from SIN/);
  assert.equal(out.ops[0].details.code, 'JL513');
  assert.equal(out.ops[0].describe, 'Add JL513, HND 11am to CTS 12:35pm');
});

test('an edit already pinned at its airport is not looked up again, and keeps its pin', async () => {
  const trip = { start_date: '2026-12-03', destination: 'Japan' };
  const op = {
    kind: 'add_activity', day: '2026-12-05', title: 'Flight to Sapporo', category: 'transport', subtype: 'flight',
    location: 'Tokyo Haneda International Airport', lat: 35.5497, lng: 139.787, details: { from: 'HND', to: 'CTS', code: 'JL513' },
  };
  const expanded = expandAll([op, { ...op, lat: null, lng: null, title: 'Elsewhere', location: 'Somewhere, Tokyo' }], []);
  assert.deepEqual(placesToLookUp(expanded, [], trip).targets.map((t) => t.title), ['Elsewhere']);
  let added = [];
  await applyChanges({
    expanded: [op], activities: [], trip, api: { addActivities: async (rows) => { added = rows; } },
  });
  assert.equal(added[0].lat, 35.5497);
  assert.equal(added[0].location, 'Tokyo Haneda International Airport');
  assert.equal(added[0].details.code, 'JL513');
});

test('every way of making entries goes through the same two checks', () => {
  // Server: the editor matches flights before it proposes, for both its callers.
  const edits = read('lib/tripEdits.js');
  assert.match(edits, /findRealFlightsForEdits\(clean\.ops/);
  assert.match(edits, /findRealStaysForEdits\(clean\.ops/);
  assert.match(read('app/api/command/route.js'), /home: homeOf\(user\), userId: user\.id/);
  const ask = read('app/api/trips/ask/route.js');
  assert.match(ask, /home: homeOf\(user\), userId: user\.id, said/);
  assert.match(ask, /said: question/, 'only the traveller\'s own flight numbers are trusted');
  // The browser: one helper, flights then places, for quick add and suggestions.
  assert.match(read('lib/entryChecks.js'), /mode: 'legs', rows: list/);
  assert.match(read('components/QuickAdd.jsx'), /checkNewEntries\(drafts/);
  assert.match(read('components/AiSuggest.jsx'), /checkNewEntries\(/);
  const parse = read('app/api/parse/route.js');
  assert.match(parse, /'subtype', 'details'/, 'quick add can say what a flight is');
  // The route is the service's door, not a second copy of it.
  const route = read('app/api/flights/route.js');
  assert.match(route, /await findRealFlights\(rows/);
  assert.match(route, /await findRealFlights\(ways/);
  assert.doesNotMatch(route, /searchOffers|pickOffer/);
  // The planner: the same flight step and the same place sorting as the editor.
  const page = read('app/plan/page.js');
  assert.match(page, /fetchRealFlights\(flightRows\.map/);
  assert.match(page, /await Promise\.all\(\[\s*findFlights\(\), findPlaces\(\), findStays\(\), findJourneys\(\),\s*\]\)/, 'every check at once');
  assert.match(page, /splitPlaceMatches\(results, targets\)/);
  assert.match(page, /withChosenPlaces\(resolved, uncertain, selected\)/);
});

test('the planner finds the flights before it plans, and keeps the home it was told', () => {
  const page = read('app/plan/page.js');
  assert.match(page, /mode: 'trip', prompt: brief/);
  assert.match(page, /\.\.\.\(fixed \? \{ fixed \} : \{\}\)/, 'every request for the plan, resumes too');
  assert.match(page, /supabase\.auth\.updateUser\(\{ data: \{ home \} \}\)/);
  assert.match(page, /if \(leg\.day > end\) end = leg\.day/, 'a connection home the next day is inside the trip');
  const route = read('app/api/plan/route.js');
  assert.match(route, /fixed = cleanFixed\(body\.fixed\)/);
  assert.match(route, /\$\{fixedBlock\(fixed\)\}/);
  assert.match(route, /!isHomeFlight\(activity, fixed, day\)/);
  assert.match(route, /if \(askOrigin\) questions\.push\(ORIGIN_QUESTION\)/);
  assert.match(route, /details\.from and details\.to are the airports' three-letter IATA codes/);
});

/* ------------------------------------------------- both checks at once --- */

test('with no key, every flight is still pinned at its airport with both clocks', async () => {
  const was = process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;
  try {
    const out = await findRealFlights([flightDraft({ location: '' })], { index });
    assert.equal(out.why, 'no_key');
    const [[flight]] = out.groups;
    assert.equal(flight.location, 'Tokyo Haneda International Airport');
    assert.equal(flight.details.arrival_timezone, 'Asia/Tokyo');
    assert.equal(flight.start_time, '10:30', 'their times stand');
  } finally {
    if (was !== undefined) process.env.SERPAPI_API_KEY = was;
  }
});

test('new entries have their flights and places checked at the same time', async () => {
  const { checkNewEntries } = await import('../lib/entryChecks.js');
  const was = globalThis.fetch;
  const open = [];
  const log = [];
  let release;
  const gate = new Promise((done) => { release = done; });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    log.push(url);
    open.push(url);
    // Neither answers until both have been asked: run one after the other, this never ends.
    if (open.length === 2) release();
    await gate;
    if (url === '/api/flights') {
      const real = { ...body.rows[0], start_time: '11:00', lat: 35.5, lng: 139.7, details: { ...body.rows[0].details, code: 'JL513' } };
      return { ok: true, json: async () => ({ groups: [[real]] }) };
    }
    return { ok: true, json: async () => ({ results: body.items.map((it) => ({ id: it.id, found: true, lat: 35.67, lng: 139.76, label: 'Ginza Six, Tokyo' })) }) };
  };
  try {
    const out = await Promise.race([
      checkNewEntries([
        { day: '2026-12-05', title: 'Ginza Six', category: 'shopping', location: 'Ginza Six' },
        flightDraft(),
      ], { bias: 'Tokyo' }),
      new Promise((_, fail) => { setTimeout(() => fail(new Error('the checks ran one after the other')), 2000); }),
    ]);
    assert.deepEqual(log.slice().sort(), ['/api/flights', '/api/places/resolve']);
    assert.equal(out[0].location, 'Ginza Six, Tokyo', 'the order they came in');
    assert.equal(out[1].details.code, 'JL513');
  } finally {
    globalThis.fetch = was;
  }
});

