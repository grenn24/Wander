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

test('an option not among them shows the first; no options, nothing', () => {
  assert.equal(trainDrawing([one, two], 'gone').shownId, 'Marunouchi Line');
  assert.equal(trainDrawing([], 'x'), null);
});
