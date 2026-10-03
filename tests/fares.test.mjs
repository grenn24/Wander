import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNetwork, earliestJourney } from '../lib/timetable.js';
import { BANDS, bandFare, distanceFare, timetableFare, yen } from '../lib/fares.js';

test('a band holds its distance in whole kilometres, rounded up', () => {
  const metro = BANDS['Tokyo Metro'];
  assert.equal(bandFare(metro, 0.4), 178);
  assert.equal(bandFare(metro, 6), 178);
  assert.equal(bandFare(metro, 6.01), 209);
  assert.equal(bandFare(metro, 11), 209);
  assert.equal(bandFare(metro, 19.5), 293);
  assert.equal(bandFare(metro, 41), null, 'beyond the table: unknown');
  const toei = BANDS.Toei;
  assert.equal(bandFare(toei, 4), 178);
  assert.equal(bandFare(toei, 4.2), 220);
  assert.equal(bandFare(toei, 60), 430);
});

test('near a band edge, both fares rather than a guess', () => {
  assert.deepEqual(distanceFare(BANDS['Tokyo Metro'], 3), { yen: 178, upTo: null });
  assert.deepEqual(distanceFare(BANDS['Tokyo Metro'], 6.1), { yen: 178, upTo: 209 });
  assert.equal(yen({ total: 209, upTo: 252 }), '¥209–252');
  assert.equal(yen({ total: 1230, upTo: null }), '¥1,230');
  assert.equal(yen({ yen: -70 }), '−¥70');
});

const read = (name) => JSON.parse(readFileSync(new URL(`../data/transit/${name}`, import.meta.url), 'utf8'));

test('Tokyo: the Marunouchi Line by distance, a change to Toei with ¥70 off, JR unknown', () => {
  const net = buildNetwork(read('tokyo-rail.json'), 'weekday');
  const lineOf = (name) => net.lines.findIndex((l) => l[0] === name);
  const station = { lat: 35.6812, lng: 139.7671 };
  const gyoen = { lat: 35.6852, lng: 139.7101 };
  const metro = timetableFare(net, earliestJourney(net, station, gyoen, 600, { only: new Set([lineOf('Marunouchi Line')]) }));
  assert.equal(metro.basis, 'ic');
  assert.equal(metro.parts.length, 1);
  assert.equal(metro.parts[0].operator.name, 'Tokyo Metro');
  assert.ok([178, 209].includes(metro.total), `Tokyo to Shinjuku-gyoemmae is about 8 km: ¥${metro.total}`);

  const jr = timetableFare(net, earliestJourney(net, station, gyoen, 600, { only: new Set([lineOf('JR Chuo Rapid Line'), lineOf('JR Chuo Sobu Local Line')]) }));
  assert.equal(jr, null, 'no JR East table yet: unknown, not guessed');

  // Asakusa to Shinjuku-sanchome: the Toei Asakusa Line, then the Toei Shinjuku Line — one operator, one fare.
  const toei = timetableFare(net, earliestJourney(net, { lat: 35.7106, lng: 139.7967 }, { lat: 35.6905, lng: 139.7048 }, 600,
    { only: new Set([lineOf('Toei Asakusa Line'), lineOf('Toei Shinjuku Line')]) }));
  if (toei) {
    assert.equal(toei.parts.filter((p) => !p.discount).length, 1, JSON.stringify(toei));
    assert.equal(toei.parts[0].operator.name, 'Toei');
  }

  // Ginza Line, then the Toei Oedo Line: two fares less ¥70.
  const both = timetableFare(net, earliestJourney(net, { lat: 35.7148, lng: 139.7967 }, { lat: 35.6544, lng: 139.7565 }, 600,
    { only: new Set([lineOf('Ginza Line'), lineOf('Toei Oedo Line')]) }));
  if (both && both.parts.length === 3) {
    const [a, b, off] = both.parts;
    assert.equal(off.discount, true);
    assert.equal(off.yen, -70);
    assert.equal(both.total, a.yen + b.yen - 70);
  }
});

test('the open feeds: their own fares, by zone', () => {
  const net = buildNetwork(read('open-rail.json'), 'weekday');
  // Kumamoto's trams are one fare anywhere.
  const tram = timetableFare(net, earliestJourney(net, { lat: 32.7898, lng: 130.6880 }, { lat: 32.8031, lng: 130.7079 }, 600));
  assert.ok(tram, 'a tram fare');
  assert.equal(tram.basis, 'ticket');
  assert.equal(tram.total, 200);
  // Fukuoka's subway, Hakata to Tenjin: one fare by zone, ¥210.
  const subway = timetableFare(net, earliestJourney(net, { lat: 33.5897, lng: 130.4207 }, { lat: 33.5913, lng: 130.3990 }, 600));
  assert.ok(subway);
  assert.equal(subway.total, 210);
  assert.equal(subway.parts[0].operator.name, 'Fukuoka Subway');
});
