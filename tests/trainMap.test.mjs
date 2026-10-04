import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePath } from '../lib/polyline.js';
import { trainDrawing } from '../lib/trainMap.js';

const line = (id, colour) => ({ id, name: id, code: id[0], colour, shape: 'round', operator: { name: 'Tokyo Metro', mark: 'TM', colour: '#0079A8' } });
const p = (lat, lng) => ({ lat, lng });
const walkLeg = (minutes, a, b, extra = {}) => ({ kind: 'walk', minutes, polyline: encodePath([a, b]), ...extra });
const rideLeg = (l, pts, minutes) => ({
  kind: 'ride', minutes, line: l, from: 'A', to: 'B', toward: 'Z', stops: [], every: 4, polyline: encodePath(pts),
});
const metro = line('Marunouchi Line', '#F62E36');
const chuo = line('Chuo Rapid Line', '#F15A22');
const one = {
  id: 'Marunouchi Line', seconds: 1440, changes: 0,
  legs: [walkLeg(3, p(35.68, 139.76), p(35.681, 139.765)), { kind: 'wait', minutes: 2 },
    rideLeg(metro, [p(35.681, 139.765), p(35.68, 139.74), p(35.685, 139.71)], 15),
    walkLeg(4, p(35.685, 139.71), p(35.684, 139.708), { exit: 'Exit 2' })],
};
const two = {
  id: 'Chuo Rapid Line', seconds: 1500, changes: 0,
  legs: [walkLeg(4, p(35.68, 139.76), p(35.681, 139.767)), rideLeg(chuo, [p(35.681, 139.767), p(35.69, 139.70)], 14)],
};

test('the shown option drawn leg by leg, the others faint', () => {
  const d = trainDrawing([one, two], 'Marunouchi Line', { to: 'Shinjuku Gyoen', walk: '#9bc53d' });
  assert.equal(d.shownId, 'Marunouchi Line');
  assert.deepEqual(d.segments.map((s) => [s.kind, s.colour, s.path.length]), [
    ['walk', '#9bc53d', 2], ['ride', '#F62E36', 3], ['walk', '#9bc53d', 2],
  ]);
  assert.equal(d.segments[1].tip.title, 'Marunouchi Line');
  assert.equal(d.faint.length, 1);
  assert.equal(d.faint[0].id, 'Chuo Rapid Line');
  assert.equal(d.faint[0].path.length, 4);
  assert.match(d.faint[0].tip.meta, /click to show/);
  assert.deepEqual(d.marks.map((m) => [m.kind, m.label || (m.line && m.line.code) || '']), [
    ['walk', '3 min'], ['board', 'M'], ['station', ''], ['walk', '4 min'], ['exit', 'Exit 2'],
  ]);
});

test('a walk out of an exit marks the exit, and its minutes beyond it', () => {
  const station = p(35.685, 139.71);
  const exit = p(35.6846, 139.7092);
  const gyoen = p(35.684, 139.708);
  const out = { ...one, legs: [...one.legs.slice(0, -1), { kind: 'walk', minutes: 4, exit: 'Exit 2', polyline: encodePath([station, exit, gyoen]) }] };
  const { marks } = trainDrawing([out], out.id);
  const near = (a, b) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
  const exitMark = marks.find((m) => m.kind === 'exit');
  const walkMark = marks.filter((m) => m.kind === 'walk').pop();
  assert.ok(near(exitMark.at, exit), 'the exit is marked where it is');
  assert.ok(near(walkMark.at, p((exit.lat + gyoen.lat) / 2, (exit.lng + gyoen.lng) / 2)), 'the minutes halfway from the exit');
});

test('an option not among them shows the first; no options, nothing', () => {
  assert.equal(trainDrawing([one, two], 'gone').shownId, 'Marunouchi Line');
  assert.equal(trainDrawing([], 'x'), null);
});

test('the trip map: a train hop says what it rides and opens; an open hop is drawn alone', async () => {
  const { hopLines } = await import('../lib/trainMap.js');
  const hop = (key, a, b) => ({ key, from: a, to: b, toTitle: `To ${key}`, day: '2026-11-10' });
  const hops = [hop('a', p(35.68, 139.76), p(35.685, 139.71)), hop('b', p(35.685, 139.71), p(35.69, 139.70))];
  const legs = {
    byKey: {
      a: { drawn: 'TRANSIT', options: [{ mode: 'TRANSIT', polyline: encodePath([p(35.68, 139.76), p(35.685, 139.71)]), trains: [one, two] }] },
      b: { drawn: 'WALK', options: [{ mode: 'WALK', polyline: encodePath([p(35.685, 139.71), p(35.69, 139.70)]) }] },
    },
  };
  const colourOf = () => '#9bc53d';

  const all = hopLines(hops, legs, { trains: true, colourOf });
  assert.equal(all.length, 2);
  assert.equal(all[0].open, 'a', 'the train opens its hop');
  assert.equal(all[0].tip.title, 'Marunouchi');
  assert.match(all[0].tip.meta, /click to show/);
  assert.equal(all[1].tip, undefined, 'a walk says nothing');

  const focused = hopLines(hops, legs, { trains: true, open: 'a', shown: { a: 'Chuo Rapid Line' }, colourOf });
  assert.equal(focused.length, 1, 'the open hop alone');
  assert.equal(focused[0].train.shownId, 'Chuo Rapid Line');
  assert.deepEqual(focused[0].train.faint, [], 'and no other options under it');

  const picked = hopLines(hops, legs, { open: 'a', colourOf });
  assert.equal(picked.length, 2, 'picked stops: every hop, as drawn');
  assert.equal(picked[0].tip, undefined);
});
