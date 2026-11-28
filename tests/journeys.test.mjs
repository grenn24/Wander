import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  journeysToLookUp, stationQuery, readTimedRoute, journeyWithRoute, journeyWithTypical,
  findRealJourneys, findRealJourneysForEdits,
} from '../lib/realJourneys.js';
import { proposeEdits } from '../lib/tripEdits.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// The shape of a Google Routes transit answer, with a change at Augsburg.
const stop = (name, lat, lng) => ({ name, location: { latLng: { latitude: lat, longitude: lng } } });
const ride = (line, trip, from, to, dep, arr, headsign) => ({
  transitDetails: {
    stopDetails: { departureStop: from, arrivalStop: to, departureTime: dep, arrivalTime: arr },
    localizedValues: { departureTime: { timeZone: 'Europe/Berlin' }, arrivalTime: { timeZone: 'Europe/Berlin' } },
    headsign,
    transitLine: { name: line, nameShort: line, agencies: [{ name: 'Deutsche Bahn' }], vehicle: { type: 'HIGH_SPEED_TRAIN' } },
    tripShortText: trip,
  },
});
const FRANKFURT = stop('Frankfurt (Main) Hbf', 50.107, 8.663);
const AUGSBURG = stop('Augsburg Hbf', 48.365, 10.886);
const MUNICH = stop('München Hbf', 48.140, 11.558);
const ROUTE = {
  duration: '12000s',
  travelAdvisory: { transitFare: { currencyCode: 'EUR', units: '39', nanos: 900000000 } },
  legs: [{
    steps: [
      { travelMode: 'WALK' },
      ride('ICE', 'ICE 597', FRANKFURT, AUGSBURG, '2026-12-05T08:13:00Z', '2026-12-05T11:05:00Z', 'München Hbf'),
      ride('RE', 'RE 4071', AUGSBURG, MUNICH, '2026-12-05T11:20:00Z', '2026-12-05T11:58:00Z', 'München Hbf'),
    ],
  }],
};
const train = (extra = {}) => ({
  day: '2026-12-05', title: 'Train to Munich', start_time: '09:00', category: 'transport', subtype: 'train',
  details: { from: 'Frankfurt', to: 'Munich' }, notes: 'Sit on the left for the Main.', cost: 0, ...extra,
});

/* ---------------------------------------------------------- reading --- */

test('only trains, buses and ferries between two places are looked up', () => {
  const targets = journeysToLookUp([
    train(),
    train({ subtype: 'flight' }),
    train({ details: { from: 'Frankfurt' } }),
    train({ subtype: 'bus', details: { from: 'Busta Shinjuku', to: 'Kawaguchiko', code: 'K-12' } }),
    train({ booking_ref: 'DB-1' }),
  ], 'we are on k12');
  assert.deepEqual(targets.map((t) => [t.index, t.kind, t.time, t.trusted]), [
    [0, 'train', '09:00', false], [3, 'bus', '09:00', true], [4, 'train', '09:00', true],
  ]);
  assert.equal(stationQuery('train', 'Kyoto'), 'Kyoto Station');
  assert.equal(stationQuery('train', 'München Hbf'), 'München Hbf');
  assert.equal(stationQuery('bus', 'Busta Shinjuku'), 'Busta Shinjuku');
});

test('Google\'s answer reads as the services ridden, in local time', () => {
  const { legs, fare } = readTimedRoute(ROUTE, 'Europe/Berlin');
  assert.equal(legs.length, 2, 'the walk is not a service');
  assert.deepEqual([legs[0].trip, legs[0].from, legs[0].departs.time, legs[0].arrives.time],
    ['ICE 597', 'Frankfurt (Main) Hbf', '09:13', '12:05'], 'UTC read on the station clock');
  assert.deepEqual(legs[1].toAt, { lat: 48.14, lng: 11.558 });
  assert.deepEqual(fare, { currency: 'EUR', amount: 39.9 });
  assert.deepEqual(readTimedRoute(null, 'Europe/Berlin').legs, []);
});

test('a journey with its real service: times, line, stations, fare and pin', () => {
  const real = journeyWithRoute(train(), readTimedRoute(ROUTE, 'Europe/Berlin'), { currency: 'EUR' });
  assert.equal(real.start_time, '09:13');
  assert.equal(real.end_time, '12:58');
  assert.deepEqual(real.details, {
    from: 'Frankfurt (Main) Hbf', to: 'München Hbf', carrier: 'ICE', code: 'ICE 597',
    _arrive: { q: 'München Hbf', lat: 48.14, lng: 11.558 },
  });
  assert.equal(real.lat, 50.107, 'pinned where it leaves');
  assert.equal(real.cost, 39.9);
  assert.match(real.notes, /^ICE 597 towards München Hbf, then RE 4071 towards München Hbf from Augsburg Hbf\. 3h 45m with 1 change\. Fare about €39\.90\./);
  assert.match(real.notes, /\nSit on the left for the Main\.$/);
  assert.equal(journeyWithRoute(train(), readTimedRoute(ROUTE, 'Europe/Berlin'), { currency: 'JPY' }).cost, 0,
    'a fare in another currency is not the trip\'s cost');
  const ferry = journeyWithRoute(train({ subtype: 'ferry' }), readTimedRoute(ROUTE, 'Europe/Berlin'), { currency: 'EUR' });
  assert.equal(ferry.details.code, undefined, 'a ferry has no service number field');
  assert.equal(ferry.details.carrier, 'Deutsche Bahn', 'a bus or ferry is named by who runs it');
  assert.equal(journeyWithRoute(train(), { legs: [] }), null);
});

test('in Japan, the real lines and a typical journey time from the app\'s own timetables', () => {
  const typical = {
    found: true, source: 'timetable', seconds: 8520,
    lines: [{ name: 'Tokaido Shinkansen' }, { name: 'JR Nara Line' }],
  };
  const real = journeyWithTypical(train({ details: { from: 'Tokyo', to: 'Nara' }, start_time: '08:00' }), typical);
  assert.equal(real.end_time, '10:22');
  assert.equal(real.start_time, '08:00', 'the planned departure stands');
  assert.equal(real.details.carrier, 'Tokaido Shinkansen');
  assert.match(real.notes, /^Typical journey from the timetable: Tokaido Shinkansen, then JR Nara Line, about 2h 22m\./);
  assert.equal(journeyWithTypical(train(), { found: true, source: 'walk', lines: [] }), null, 'a walk is not a train');
});

/* ---------------------------------------------------------- the service --- */

const places = {
  'Frankfurt Station': { name: 'Frankfurt (Main) Hbf', lat: 50.107, lng: 8.663 },
  'Munich Station': { name: 'München Hbf', lat: 48.14, lng: 11.558 },
  'Tokyo Station': { name: 'Tokyo Station', lat: 35.681, lng: 139.767 },
  'Kyoto Station': { name: 'Kyoto Station', lat: 34.985, lng: 135.758 },
};
function tools(asked = []) {
  return {
    configured: () => true,
    find: async (q) => { asked.push(`find ${q}`); return places[q] || null; },
    own: (p) => p.lat > 30 && p.lng > 129,
    typical: async () => { asked.push('typical'); return { found: true, source: 'model', seconds: 8400, lines: [{ name: 'Tokaido Shinkansen' }] }; },
    timed: async ({ departAt, kind }) => { asked.push(`timed ${new Date(departAt).toISOString()} ${kind}`); return ROUTE; },
  };
}
const NOW = Date.parse('2026-11-28T12:00:00Z');

test('one service finds each journey\'s real service, the right way for where it runs', async () => {
  const asked = [];
  const out = await findRealJourneys([
    train(),
    train({ details: { from: 'Tokyo', to: 'Kyoto' }, start_time: '08:00' }),
    { title: 'Dinner', category: 'food' },
  ], { tools: tools(asked), zone: 'Europe/Berlin', currency: 'EUR', now: NOW });
  assert.deepEqual(out.found, [true, true, false]);
  assert.equal(out.entries[0].details.code, 'ICE 597');
  assert.equal(out.entries[1].details.carrier, 'Tokaido Shinkansen');
  assert.equal(out.entries[1].end_time, '10:20');
  assert.ok(asked.includes('timed 2026-12-05T08:00:00.000Z train'), 'asked for 09:00 Frankfurt time');
  assert.ok(asked.includes('typical'));
});

test('a booked journey, a past one or one with no clock keeps its times, pinned at its stations', async () => {
  const pinnedOnly = async (entry, opts) => {
    const asked = [];
    const out = await findRealJourneys([entry], { tools: tools(asked), currency: 'EUR', now: NOW, ...opts });
    assert.equal(out.found[0], false);
    assert.equal(out.entries[0].start_time, entry.start_time);
    assert.equal(out.entries[0].lat, 50.107);
    assert.deepEqual(out.entries[0].details._arrive, { q: 'Munich', lat: 48.14, lng: 11.558 });
    assert.ok(!asked.some((a) => a.startsWith('timed')));
  };
  await pinnedOnly(train({ booking_ref: 'DB-123' }), { zone: 'Europe/Berlin' });
  await pinnedOnly(train({ day: '2026-11-01' }), { zone: 'Europe/Berlin' });
  await pinnedOnly(train(), { zone: '' });
  const lost = await findRealJourneys([train({ details: { from: 'Atlantis', to: 'Munich' } })], {
    tools: tools(), zone: 'Europe/Berlin', now: NOW,
  });
  assert.equal(lost.entries[0].lat, undefined, 'no station found: kept as written for the place check');
  const off = await findRealJourneys([train()], { tools: { ...tools(), configured: () => false } });
  assert.equal(off.why, 'no_key');
});

/* -------------------------------------------------------- the editor --- */

const blank = Object.fromEntries(['kind', 'describe', 'activity_id', 'day', 'title', 'start_time', 'end_time',
  'category', 'subtype', 'details', 'location', 'named_place', 'cost', 'notes', 'items'].map((k) => [k, null]));
const match = (entries, opts) => findRealJourneys(entries, { ...opts, tools: tools(), now: NOW });
const trip = { start_date: '2026-12-01', end_date: '2026-12-08', currency: 'EUR', timezone: 'Europe/Berlin' };

test('the editor proposes the real service: a new train, a moved one, a booked one kept', async () => {
  const booked = {
    id: 't1', day: '2026-12-04', title: 'Train to Munich', start_time: '07:00', end_time: '10:40',
    category: 'transport', subtype: 'train', notes: 'Seat 61', details: { from: 'Frankfurt', to: 'Munich', code: 'ICE 591' },
  };
  const ops = await findRealJourneysForEdits([
    { ...blank, kind: 'add_activity', describe: 'Add a train', day: '2026-12-05', title: 'Train to Munich', start_time: '09:00', category: 'transport', subtype: 'train', details: { from: 'Frankfurt', to: 'Munich' } },
    { ...blank, kind: 'update_activity', describe: 'Take a later train', activity_id: 't1', start_time: '09:00' },
    { ...blank, kind: 'update_activity', describe: 'Move it a day', activity_id: 't1', day: '2026-12-05' },
  ], { activities: [booked], trip, said: 'add a train to munich', match });
  assert.equal(ops[0].describe, 'Add ICE 597, Frankfurt (Main) Hbf 9:13am to München Hbf 12:58pm');
  assert.equal(ops[0].lat, 50.107, 'pinned at the station');
  assert.equal(ops[0].details._arrive, undefined, 'the trip page finds the arrival pin');
  assert.equal(ops[0].cost, 39.9);
  assert.equal(ops[1].describe, 'Change to ICE 597, Frankfurt (Main) Hbf 9:13am to München Hbf 12:58pm');
  assert.equal(ops[1].notes, null, 'their notes are theirs');
  assert.equal(ops[2].start_time, null, 'only the day moved: their train, their times');
  assert.equal(ops[2].describe, 'Move it a day');
});

test('the shared editor runs the flight, stay and journey checks together', async () => {
  const started = [];
  const out = await proposeEdits({
    instruction: 'Add a train to Munich on the 5th at 9',
    trip: { ...trip, name: 'Germany' },
    ask: async () => ({
      understood: true,
      question: null,
      summary: 's',
      ops: [
        { kind: 'add_activity', describe: 'Add a train', day: '2026-12-05', title: 'Train to Munich', start_time: '09:00', category: 'transport', subtype: 'train', details: { from: 'Frankfurt', to: 'Munich' } },
        { kind: 'add_activity', describe: 'Add a hotel', day: '2026-12-05', title: 'Hotel Bayerischer Hof', category: 'lodging', location: 'Munich', details: { check_in_date: '2026-12-05', check_out_date: '2026-12-07' } },
        { kind: 'add_activity', describe: 'Add a flight', day: '2026-12-07', title: 'Flight home', start_time: '18:00', category: 'transport', subtype: 'flight', details: { from: 'MUC', to: 'SIN' } },
      ],
    }),
    match: async (drafts) => { started.push('flights'); return { groups: drafts.map((d) => [d]), found: drafts.map(() => false) }; },
    matchStays: async (entries) => { started.push('stays'); return { entries, found: entries.map(() => false) }; },
    matchJourneys: async (entries, opts) => { started.push('journeys'); return match(entries, opts); },
  });
  assert.deepEqual(started.slice().sort(), ['flights', 'journeys', 'stays']);
  assert.equal(out.ops[0].details.code, 'ICE 597');
  assert.deepEqual(out.ops.map((o) => o.describe.split(' ')[0]), ['Add', 'Add', 'Add'], 'every edit kept, in order');
});

/* ------------------------------------------------------------- wiring --- */

test('every way of making entries checks journeys through the same service', () => {
  assert.match(read('app/api/journeys/route.js'), /await findRealJourneys\(rows/);
  const checks = read('lib/entryChecks.js');
  assert.match(checks, /await Promise\.all\(\[\s*fetchRealFlights[\s\S]*fetchRealJourneys[\s\S]*fetchRealStays[\s\S]*fetchExactPlaces/);
  assert.match(read('app/plan/page.js'), /fetchRealJourneys\(journeyRows\.map/);
  assert.match(read('components/QuickAdd.jsx'), /zone: trip\.timezone \|\| ''/);
  assert.match(read('lib/tripEdits.js'), /findRealJourneysForEdits\(clean\.ops/);
  assert.match(read('lib/routes.js'), /export async function transitAt/);
  for (const path of ['app/api/plan/route.js', 'lib/tripEdits.js']) {
    assert.match(read(path), /A train, bus or ferry's details\.from and details\.to are the stations/);
  }
});
