import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNetwork } from '../lib/timetable.js';
import { buildModel } from '../lib/railModel.js';
import { timetableOptions, modelOptions } from '../lib/trainOptions.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/transit/${name}`, import.meta.url), 'utf8'));
const minutesOf = (o) => o.legs.reduce((s, l) => s + l.minutes, 0);

function wellFormed(o) {
  assert.ok(o.id, 'an option has an id');
  assert.ok(Math.abs(minutesOf(o) - o.seconds / 60) <= 1, `${o.id}: legs ${minutesOf(o)} against ${o.seconds / 60}`);
  o.legs.forEach((l) => {
    assert.ok(['walk', 'wait', 'ride'].includes(l.kind));
    assert.ok(Number.isFinite(l.minutes) && l.minutes >= 0, `${l.kind} minutes ${l.minutes}`);
    if (l.kind === 'ride') {
      assert.ok(l.line.name && l.line.id, 'a ride names its line');
      assert.ok(['round', 'square'].includes(l.line.shape));
      assert.ok(l.from && l.to && l.toward, 'a ride says where from, where to, and which way');
      assert.ok(l.polyline, 'a ride has its line to draw');
      assert.ok(Array.isArray(l.stops));
    }
  });
}

test('Tokyo: Tokyo Station to Shinjuku Gyoen has other ways than the fastest', () => {
  const net = buildNetwork(read('tokyo-rail.json'), 'weekday');
  const station = { lat: 35.6812, lng: 139.7671 };
  const gyoen = { lat: 35.6852, lng: 139.7101 };
  const { options, journeys } = timetableOptions(net, station, gyoen);
  assert.ok(options.length >= 2, `${options.length} options: ${options.map((o) => o.id).join(' | ')}`);
  assert.equal(new Set(options.map((o) => o.id)).size, options.length, 'each a different way');
  assert.equal(journeys.length, options.length);
  options.forEach(wellFormed);
  assert.ok(options[0].tags.includes('fastest'));
  options.forEach((o, i) => { if (i) assert.ok(o.seconds >= options[i - 1].seconds); });
  const rides = options[0].legs.filter((l) => l.kind === 'ride');
  assert.ok(rides[0].every > 0 && rides[0].every < 15, `every ${rides[0].every} min`);
  assert.equal(rides[0].next, null, 'planning a day ahead names no next train');

  // A saved route comes first, with its times fresh.
  const second = options[1];
  const saved = timetableOptions(net, station, gyoen, { prefer: second.id.split('>') });
  assert.equal(saved.options[0].id, second.id);
  assert.ok(saved.options[0].tags.includes('saved'));
  assert.equal(saved.preferMissing, false);
  const gone = timetableOptions(net, station, gyoen, { prefer: ['No Such Line'] });
  assert.equal(gone.preferMissing, true);

  // Leaving now: the next train is named, and the stops passed have their times.
  const now = timetableOptions(net, station, gyoen, { minute: 600 });
  const ride = now.options[0].legs.find((l) => l.kind === 'ride');
  assert.equal(ride.next, ride.leaves);
  ride.stops.forEach((s) => assert.ok(s.time >= ride.leaves && s.time <= ride.arrives));
});

test('Japan: Osaka Station to Dōtonbori, estimated, has other ways too', () => {
  const model = buildModel(read('japan-rail.json'));
  const { options } = modelOptions(model, { lat: 34.7025, lng: 135.4959 }, { lat: 34.6687, lng: 135.5013 });
  assert.ok(options.length >= 2, options.map((o) => o.id).join(' | '));
  options.forEach(wellFormed);
  options.forEach((o) => assert.equal(o.source, 'model'));
  assert.ok(options.some((o) => o.lines.includes('Midōsuji Line')));
  const ride = options[0].legs.find((l) => l.kind === 'ride');
  assert.ok(ride.every > 0, 'how often, from the trains a day');
  assert.equal(ride.leaves, null, 'no timetable, no times');
  assert.equal(ride.line.operator.name, 'Osaka Metro');

  const second = options[1];
  const saved = modelOptions(model, { lat: 34.7025, lng: 135.4959 }, { lat: 34.6687, lng: 135.5013 }, { prefer: second.id.split('>') });
  assert.equal(saved.options[0].id, second.id);
});
