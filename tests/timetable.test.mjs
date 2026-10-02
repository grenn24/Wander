import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FORMAT, packTiming, unpackTiming, packTrain, unpackTrain, buildNetwork, earliestJourney,
  typicalJourney, asRoute, covers, tokyoClock, encodePath, walkFor,
} from '../lib/timetable.js';
import { decodePath } from '../lib/geo.js';
import { TOKYO_AREA } from '../lib/timetableRegions.js';

test('minute runs and trains survive packing, including the rare long one', () => {
  const values = [0, 1, 2, 60, 61, 62, 95, 400, 3];
  assert.deepEqual(unpackTiming(packTiming(values)), values);
  assert.equal(packTiming([2, 0, 3, 1]).length, 4); // a character a value, as nearly all are
  const train = { seq: 2078, timing: 30899, start: 1530, type: 169 };
  const packed = packTrain(train) + packTrain({ seq: 0, timing: 0, start: 270, type: 0 });
  assert.deepEqual(unpackTrain(packed, 0), train);
  assert.deepEqual(unpackTrain(packed, 1), { seq: 0, timing: 0, start: 270, type: 0 });
  assert.throws(() => packTrain({ seq: 62 * 62, timing: 0, start: 0, type: 0 }), RangeError);
});

test('the encoded line is Google\'s own format', () => {
  // The worked example in Google's documentation.
  const points = [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }];
  assert.equal(encodePath(points), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.deepEqual(decodePath(encodePath(points)), points);
});

/*
 * A small made-up city:
 *
 *   Red line   r0 — r1 — r2          trains every 10 minutes from 10:00, 3 minutes a stop
 *   Blue line        b1 — b2         b1 is in the same station as r1
 *   Green line                g0 — g1   g0 is a through train's continuation of the Red line at r2
 *
 * Stations sit 1.5 km apart, beyond the kilometre the planner walks to a
 * station without asking, so each answer has one right train.
 */
const step = 0.0165; // degrees of longitude, about 1.5 km at this latitude
const at = (i, lat = 35.6) => [35.6 + (lat - 35.6), 139.7 + i * step];
function city() {
  const stops = [
    ['R0', ...at(0), 0, -1, -1],
    ['R1', ...at(1), 0, 0, 0],
    ['R2', ...at(2), 0, 1, 1],
    ['B1', ...at(1, 35.6005), 1, 0, 0],
    ['B2', ...at(1, 35.62), 1, -1, -1],
    ['G0', ...at(2, 35.6003), 2, 1, 1],
    ['G1', ...at(3), 2, -1, -1],
  ];
  const seqs = [[0, 1, 2], [3, 4], [5, 6]];
  const timings = [packTiming([3, 0, 3, 0]), packTiming([5, 0]), packTiming([4, 0])];
  const red = [0, 10, 20, 30].map((m) => ({ seq: 0, timing: 0, start: 600 + m, type: 0 }));
  // Blue leaves r1/b1 at 10:05 and 10:09: the first is too soon after the 10:03 red arrives.
  const blue = [605, 609, 640].map((start) => ({ seq: 1, timing: 1, start, type: 0 }));
  // The 10:00 red train runs on as the 10:06 green; nothing else does.
  const green = [606, 626].map((start) => ({ seq: 2, timing: 2, start, type: 0 }));
  const trains = [...red, ...blue, ...green];
  return {
    format: FORMAT,
    lines: [['Red Line', 'FF0000', 'SUBWAY'], ['Blue Line', '0000FF', 'SUBWAY'], ['Green Line', '00FF00', 'RAIL']],
    types: ['Local'],
    stops,
    seqs,
    timings,
    days: { weekday: { trains: trains.map(packTrain).join(''), through: [0, 7] } },
  };
}

const near = (stop, net) => ({ lat: net.stops[stop].lat + 0.0001, lng: net.stops[stop].lng });

test('a change of line waits for a train it can make, not the first one leaving', () => {
  const net = buildNetwork(city(), 'weekday');
  const j = earliestJourney(net, near(0, net), near(4, net), 600 - walkFor(0.011) - 2);
  const rides = j.legs.filter((l) => l.kind === 'ride');
  assert.deepEqual(rides.map((r) => r.line), ['Red Line', 'Blue Line']);
  // Red reaches R1 at 10:03; four minutes to change means the 10:05 is gone and the 10:09 is it.
  assert.equal(rides[0].arrives, 603);
  assert.equal(rides[1].leaves, 609);
  assert.equal(j.legs[j.legs.length - 1].kind, 'walk');
});

test('a train running through onto another line is stayed on, with no change', () => {
  const net = buildNetwork(city(), 'weekday');
  const j = earliestJourney(net, near(0, net), near(6, net), 595);
  const rides = j.legs.filter((l) => l.kind === 'ride');
  assert.deepEqual(rides.map((r) => [r.line, r.leaves, r.arrives, r.through]),
    [['Red Line', 600, 606, false], ['Green Line', 606, 610, true]]);
  // No walk between them: the passenger never left the train.
  const between = j.legs.slice(j.legs.indexOf(rides[0]) + 1, j.legs.indexOf(rides[1]));
  assert.deepEqual(between, []);
  // Without the through train, the 10:10 red would need a change to the 10:26 green.
  const later = earliestJourney(net, near(0, net), near(6, net), 605);
  const again = later.legs.filter((l) => l.kind === 'ride');
  assert.equal(again[1].leaves, 626);
  assert.equal(again[1].through, false);
});

test('a route answer reads like Google\'s, with departure times added', () => {
  const net = buildNetwork(city(), 'weekday');
  const j = earliestJourney(net, near(0, net), near(4, net), 595);
  const r = asRoute(net, j);
  assert.equal(r.mode, 'TRANSIT');
  assert.equal(r.found, true);
  assert.equal(r.source, 'timetable');
  assert.equal(r.seconds, (j.arrives - j.leaves) * 60);
  assert.deepEqual(r.lines.map((l) => [l.name, l.from, l.departs, l.colour]),
    [['Red Line', 'R0', '10:00', '#FF0000'], ['Blue Line', 'B1', '10:09', '#0000FF']]);
  const path = decodePath(r.polyline);
  assert.ok(path.length >= 4);
  assert.ok(r.metres > 1500 && r.metres < 5000, String(r.metres));
});

test('nothing after the last train, and nothing outside the map', () => {
  const net = buildNetwork(city(), 'weekday');
  assert.equal(earliestJourney(net, near(0, net), near(4, net), 700), null);
  const osaka = { lat: 34.7025, lng: 135.4959 };
  assert.equal(covers(net, osaka, near(4, net)), false);
  assert.equal(earliestJourney(net, osaka, near(4, net), 600), null);
  assert.equal(covers(net, near(0, net), near(4, net)), true);
});

test('a typical journey is the median of several departures, so one lucky connection does not set it', () => {
  const net = buildNetwork(city(), 'weekday');
  const from = near(0, net);
  const to = near(4, net);
  const times = [595, 600, 605, 610, 615].map((m) => {
    const j = earliestJourney(net, from, to, m);
    return j ? j.arrives - j.leaves : null;
  }).filter((x) => x != null).sort((a, b) => a - b);
  const j = typicalJourney(net, from, to, [595, 600, 605, 610, 615]);
  assert.equal(j.arrives - j.leaves, times[Math.floor((times.length - 1) / 2)]);
  assert.equal(typicalJourney(net, from, to, [800, 900]), null);
});

test('Tokyo\'s clock: the service day runs to three in the morning', () => {
  // 01:30 on Saturday in Tokyo is still Friday's weekday timetable.
  assert.deepEqual(tokyoClock(new Date('2026-10-02T16:30:00Z')), { day: 'weekday', minute: 25 * 60 + 30 });
  // Saturday noon, Sunday noon, Monday 08:15.
  assert.deepEqual(tokyoClock(new Date('2026-10-03T03:00:00Z')), { day: 'weekend', minute: 720 });
  assert.deepEqual(tokyoClock(new Date('2026-10-04T03:00:00Z')), { day: 'weekend', minute: 720 });
  assert.deepEqual(tokyoClock(new Date('2026-10-04T23:15:00Z')), { day: 'weekday', minute: 495 });
  // And 02:00 on Monday is Sunday's.
  assert.equal(tokyoClock(new Date('2026-10-04T17:00:00Z')).day, 'weekend');
});

/*
 * The real timetable, built by scripts/transit/build-tokyo.mjs. These are
 * journeys anyone in Tokyo could check on a departure board.
 */
test('Tokyo: the shipped timetable plans journeys a local would recognise', () => {
  const data = JSON.parse(readFileSync(new URL('../data/transit/tokyo-rail.json', import.meta.url), 'utf8'));
  assert.equal(data.format, FORMAT);
  assert.ok(data.source.commit, 'the build records which mini-tokyo-3d it came from');
  const net = buildNetwork(data, 'weekday');
  assert.ok(net.legs.count > 400000, `${net.legs.count} legs`);

  // Shibuya Crossing to Ueno Park: the Ginza Line, end to end, about half an hour.
  const ueno = asRoute(net, typicalJourney(net, { lat: 35.6595, lng: 139.7005 }, { lat: 35.7148, lng: 139.7732 }));
  assert.equal(ueno.lines[0].name, 'Ginza Line');
  assert.equal(ueno.lines[0].from, 'Shibuya');
  assert.ok(ueno.seconds / 60 > 30 && ueno.seconds / 60 < 55, `${ueno.seconds / 60} min`);

  // Otemachi to Futako-Tamagawa: the Hanzomon Line runs on as the Den-en-toshi Line at Shibuya.
  const futako = asRoute(net, typicalJourney(net, { lat: 35.6867, lng: 139.7639 }, { lat: 35.6116, lng: 139.6266 }));
  assert.deepEqual(futako.lines.map((l) => [l.name, l.through]),
    [['Hanzomon Line', false], ['Tokyu Den-En-Toshi Line', true]]);

  // Osaka is not in Tokyo's timetable.
  assert.equal(covers(net, { lat: 35.6812, lng: 139.7671 }, { lat: 34.7025, lng: 135.4959 }), false);

  // The server's quick test of whether to load the timetable at all must take in
  // every station and the three kilometres walked to one.
  const reach = 0.04; // degrees, a little over three kilometres either way
  data.stops.filter((s) => s[1] != null).forEach(([name, lat, lng]) => {
    assert.ok(lat - reach > TOKYO_AREA.south && lat + reach < TOKYO_AREA.north
      && lng - reach > TOKYO_AREA.west && lng + reach < TOKYO_AREA.east, `${name} is outside TOKYO_AREA`);
  });

  // No surcharge trains: Narita to Ueno is the ordinary Keisei, not the Skyliner.
  const narita = asRoute(net, typicalJourney(net, { lat: 35.7720, lng: 140.3929 }, { lat: 35.7148, lng: 139.7732 }));
  assert.ok(narita.lines.every((l) => !/Skyliner|Narita Express/.test(`${l.name} ${l.type}`)), JSON.stringify(narita.lines));
});

/*
 * The other open timetables, from the GTFS Data Repository and GitHub
 * (scripts/transit/build-gtfs.mjs), in one file.
 */
test('Open feeds: Fukuoka\'s subway, through-running included', async () => {
  const { REGIONS } = await import('../lib/timetableRegions.js');
  const data = JSON.parse(readFileSync(new URL('../data/transit/open-rail.json', import.meta.url), 'utf8'));
  const net = buildNetwork(data, 'weekday');
  const at = (name) => { const s = data.stops.find((x) => x[0] === name); return { lat: s[1], lng: s[2] }; };

  const airport = asRoute(net, typicalJourney(net, at('Fukuoka Airport'), at('Tenjin')));
  assert.deepEqual(airport.lines.map((l) => l.name), ['Kuko Line']);
  assert.ok(airport.seconds / 60 > 10 && airport.seconds / 60 < 30, `${airport.seconds / 60} min`);

  // Kūkō Line trains run on into the Hakozaki Line at Nakasu-Kawabata.
  const kaizuka = asRoute(net, typicalJourney(net, at('Meinohama'), at('Kaizuka')));
  assert.deepEqual(kaizuka.lines.map((l) => [l.name, l.through]), [['Kuko Line', false], ['Hakozaki Line', true]]);

  const area = REGIONS.find((r) => r.id === 'open').area;
  const reach = 0.04;
  data.stops.forEach(([name, lat, lng]) => assert.ok(lat - reach > area.south && lat + reach < area.north
    && lng - reach > area.west && lng + reach < area.east, `${name} is outside the open feeds' area`));
});

test('Open feeds: trams too, named in English, and no surcharge trains', () => {
  const data = JSON.parse(readFileSync(new URL('../data/transit/open-rail.json', import.meta.url), 'utf8'));
  const net = buildNetwork(data, 'weekday');
  const at = (name) => { const s = data.stops.find((x) => x[0] === name); return { lat: s[1], lng: s[2] }; };
  // Kumamoto Station to Suizenji Park: the A tram, about half an hour.
  const suizenji = asRoute(net, typicalJourney(net, at('Kumamoto Station'), at('Suizenji Park')));
  assert.equal(suizenji.lines[0].name, 'Kumamoto City Tram A');
  assert.equal(suizenji.lines[0].vehicle, 'TRAM');
  assert.ok(suizenji.seconds / 60 > 20 && suizenji.seconds / 60 < 50, `${suizenji.seconds / 60} min`);
  // Ten feeds, nearly every station named in English, and the Ise Railway's Limited Express Nanki left out.
  const names = [...new Set(data.stops.map((s) => s[0]))];
  assert.ok(names.filter((n) => /[ぁ-んァ-ン一-龥]/.test(n)).length <= names.length * 0.05, 'English names');
  assert.ok(data.lines.every(([name]) => !/特急|Nanki/.test(name)));
});
