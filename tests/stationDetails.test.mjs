import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePath, decodePath } from '../lib/polyline.js';
import { indexStations, lineKey, platformFor, exitFor, fillStationDetails } from '../lib/stationDetails.js';
import { operatorOf } from '../lib/registry.js';

const p = (lat, lng) => ({ lat, lng });
// Ueno, Kanda and Tokyo on the Keihin-Tohoku Line, both ways.
const ueno = p(35.7138, 139.7774);
const kanda = p(35.6918, 139.7709);
const tokyo = p(35.6812, 139.7671);
const data = {
  exits: [
    [35.7136, 139.7766, 'Park Exit'],
    [35.7128, 139.7771, 'Shinobazu Exit'],
    [35.6922, 139.7712, 'North Exit'],
    [35.6913, 139.7706, 'South Exit'],
    [35.7300, 139.7900, 'Exit 9'], // another station's
  ],
  routes: [
    { op: 'jr-east', names: ['JR京浜東北線（南行）', 'JR Keihin-Tohoku Line (southbound)'], stops: [[35.7138, 139.7774, '3'], [35.6918, 139.7709, '3'], [35.6812, 139.7671, '5']] },
    { op: 'jr-east', names: ['JR京浜東北線（北行）'], stops: [[35.6812, 139.7671, '6'], [35.6918, 139.7709, '4'], [35.7138, 139.7774, '4']] },
    { op: 'tokyo-metro', names: ['東京メトロ銀座線'], stops: [[35.7116, 139.7769, '1'], [35.6936, 139.7707, '2']] },
  ],
};
const index = indexStations(data);

test('a line is matched by its name without the company, "Main", or what is in brackets', () => {
  assert.equal(lineKey('JR函館本線'), lineKey('函館線'));
  assert.equal(lineKey('JR京浜東北線（南行）'), lineKey('京浜東北線'));
  assert.equal(lineKey('Keiō Line'), 'keioline');
});

test('the platform where you board, the right way round', () => {
  const op = 'jr-east';
  const names = ['京浜東北線・根岸線', 'JR Keihin-Tohoku-Negishi Line'];
  assert.equal(platformFor(index, { board: ueno, alight: tokyo, op, names }), '3', 'southbound from Ueno');
  assert.equal(platformFor(index, { board: tokyo, alight: ueno, op, names }), '6', 'northbound from Tokyo');
  assert.equal(platformFor(index, { board: kanda, alight: ueno, op, names }), '4');
  assert.equal(platformFor(index, { board: ueno, alight: tokyo, op: 'tokyo-metro', names }), null, 'another operator\'s');
  assert.equal(platformFor(index, { board: ueno, alight: tokyo, op, names: ['山手線'] }), null, 'another line');
});

test('the exit nearest where you are going, of the station you get off at', () => {
  assert.equal(exitFor(index, ueno, p(35.7148, 139.7730)).label, 'Park Exit');
  assert.equal(exitFor(index, ueno, p(35.7100, 139.7700)).label, 'Shinobazu Exit');
  assert.equal(exitFor(index, kanda, p(35.6800, 139.7700)).label, 'South Exit');
  assert.equal(exitFor(index, p(35.6, 139.6), p(35.6, 139.6)), null, 'no station there');
});

test('options get what they were missing, and keep what they had', () => {
  const line = { id: 'x', name: 'JR Keihin-Tohoku-Negishi Line', local: '京浜東北線・根岸線', operator: operatorOf('JR東日本') };
  const options = [{
    id: 'x',
    legs: [
      { kind: 'walk', minutes: 3, exit: null, polyline: encodePath([p(35.715, 139.776), ueno]) },
      { kind: 'ride', minutes: 7, line, platform: null, polyline: encodePath([ueno, kanda, tokyo]) },
      { kind: 'walk', minutes: 5, exit: null, polyline: encodePath([tokyo, p(35.6800, 139.7650)]) },
    ],
  }, {
    id: 'y',
    legs: [
      { kind: 'ride', minutes: 5, line, platform: 'Platform 9', polyline: encodePath([ueno, kanda]) },
      { kind: 'walk', minutes: 6, exit: 'Exit 1', polyline: encodePath([kanda, p(35.6800, 139.7700)]) },
    ],
  }];
  fillStationDetails(options, index);
  const [a, b] = options;
  assert.equal(a.legs[1].platform, 'Platform 3');
  assert.equal(a.legs[0].exit, null, 'the first walk has no exit');
  assert.equal(a.legs[2].exit, null, 'no exit listed at Tokyo');
  assert.equal(b.legs[0].platform, 'Platform 9', 'kept');
  assert.equal(b.legs[1].exit, 'Exit 1', 'kept');

  const c = { id: 'z', legs: [{ kind: 'ride', minutes: 5, line, platform: null, polyline: encodePath([tokyo, kanda]) },
    { kind: 'walk', minutes: 6, exit: null, polyline: encodePath([kanda, p(35.6800, 139.7700)]) }] };
  fillStationDetails([c], index);
  assert.equal(c.legs[0].platform, 'Platform 6');
  assert.equal(c.legs[1].exit, 'South Exit');
  assert.equal(decodePath(c.legs[1].polyline).length, 3, 'the walk goes through the exit');
  assert.equal(fillStationDetails([c], null)[0], c, 'no stations file, nothing changes');
});

test('the stations file: platforms and exits for real Tokyo journeys', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildNetwork } = await import('../lib/timetable.js');
  const { timetableOptions } = await import('../lib/trainOptions.js');
  const read = (name) => JSON.parse(readFileSync(new URL(`../data/transit/${name}`, import.meta.url), 'utf8'));
  const stations = read('stations/jp.json');
  assert.ok(stations.exits.length > 1000 && stations.routes.length > 500, `${stations.exits.length} exits, ${stations.routes.length} routes`);
  stations.routes.forEach((r) => r.stops.forEach(([, , platform]) => {
    if (platform) assert.match(platform, /^\d{1,2}[A-Za-z]?( or \d{1,2}[A-Za-z]?)?$/, `platform ${platform}`);
  }));
  const net = buildNetwork(read('tokyo-rail.json'), 'weekday');
  const { options } = timetableOptions(net, { lat: 35.6812, lng: 139.7671 }, { lat: 35.6852, lng: 139.7101 });
  fillStationDetails(options, indexStations(stations));
  const rides = options.flatMap((o) => o.legs.filter((l) => l.kind === 'ride'));
  assert.ok(rides.some((l) => /^Platform \d/.test(l.platform || '')), rides.map((l) => `${l.line.name}: ${l.platform}`).join(', '));
});
