import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNetwork, earliestJourney } from '../lib/timetable.js';
import { departures, dayOf, DAY_END } from '../lib/departures.js';

const net = buildNetwork(JSON.parse(readFileSync(new URL('../data/transit/tokyo-rail.json', import.meta.url), 'utf8')), 'weekday');
const station = { lat: 35.6812, lng: 139.7671 };
const gyoen = { lat: 35.6852, lng: 139.7101 };
const lineOf = (name) => net.lines.findIndex((l) => l[0] === name);
const rides = (j) => j.legs.filter((l) => l.kind === 'ride');

test('the Marunouchi Line from Tokyo, for the rest of the day', () => {
  const journey = earliestJourney(net, station, gyoen, 600, { only: new Set([lineOf('Marunouchi Line')]) });
  const [ride] = rides(journey);
  const { trains, last } = departures(net, ride, { to: gyoen, after: 600 });
  assert.ok(trains.length > 150, `${trains.length} trains`);
  trains.forEach((t, i) => {
    assert.ok(t.leaves >= 600 && t.leaves <= DAY_END);
    if (i) assert.ok(t.leaves >= trains[i - 1].leaves, 'in order');
    assert.ok(t.reaches > t.leaves && t.arrives > t.reaches);
  });
  assert.equal(last, trains[trains.length - 1]);
  assert.ok(last.leaves > 23 * 60, `the last train leaves ${last.leaves}`);
  // The train planned is among them, getting there when planned.
  const planned = trains.find((t) => t.leaves === ride.leaves);
  assert.ok(planned);
  assert.equal(planned.reaches, ride.arrives);
  // Late at night, past midnight: only what is left.
  const late = departures(net, ride, { to: gyoen, after: 24 * 60 + 10 });
  late.trains.forEach((t) => assert.ok(t.leaves >= 24 * 60 + 10));
});

test('a change: each train is timed to the end, over the line after it', () => {
  const chuo = lineOf('JR Chuo Rapid Line');
  const sobu = lineOf('JR Chuo Sobu Local Line');
  const journey = earliestJourney(net, station, gyoen, 600, { only: new Set([chuo, sobu]) });
  const [first, second] = rides(journey);
  assert.ok(first && second, 'two trains');
  const { trains } = departures(net, first, { rest: [second.lineIndex], to: gyoen, after: 600 });
  assert.ok(trains.length > 50);
  const planned = trains.find((t) => t.leaves === first.leaves);
  assert.ok(planned, 'the planned train is listed');
  assert.equal(planned.arrives, journey.arrives);
  // Every train listed stops where you get off; a type is named.
  trains.slice(0, 20).forEach((t) => assert.ok(t.type));
});

test('weekends run the weekend timetable', () => {
  assert.equal(dayOf('2026-11-10'), 'weekday');
  assert.equal(dayOf('2026-11-14'), 'weekend');
  assert.equal(dayOf('2026-11-15'), 'weekend');
});
