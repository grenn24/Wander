import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryOf, legTip, optionTip, barOf, stepsOf, linesOf, directionOf } from '../lib/trainView.js';

const metro = { id: 'Marunouchi Line', name: 'Marunouchi Line', code: 'M', colour: '#F62E36', shape: 'round', operator: { name: 'Tokyo Metro', mark: 'TM', colour: '#0079A8' } };
const chuo = { id: 'JR Chuo Rapid Line', name: 'JR Chuo Rapid Line', code: 'JC', colour: '#F15A22', shape: 'square', operator: { name: 'JR East', mark: 'JR', colour: '#007A03' } };
const ride = (line, from, to, minutes, extra = {}) => ({
  kind: 'ride', minutes, line, type: 'Local', from, to, toward: 'Ogikubo', stops: [{ name: 'A' }, { name: 'B' }], every: 4, next: null, ...extra,
});
const direct = {
  id: 'Marunouchi Line', seconds: 24 * 60, changes: 0, tags: ['fastest'],
  legs: [
    { kind: 'walk', minutes: 3 },
    { kind: 'wait', minutes: 2 },
    ride(metro, 'Tokyo', 'Shinjuku-gyoemmae', 15),
    { kind: 'walk', minutes: 4, exit: 'Exit 2' },
  ],
};
const change = {
  id: 'JR Chuo Rapid Line>Marunouchi Line', seconds: 25 * 60, changes: 1, tags: ['changes:1'],
  legs: [
    { kind: 'walk', minutes: 4 },
    { kind: 'wait', minutes: 2 },
    ride(chuo, 'Tokyo', 'Yotsuya', 8, { type: 'Rapid', toward: 'Takao', every: 5, next: 607 }),
    { kind: 'walk', minutes: 3, change: true },
    { kind: 'wait', minutes: 1 },
    ride(metro, 'Yotsuya', 'Shinjuku-gyoemmae', 3),
    { kind: 'walk', minutes: 4 },
  ],
};

test('the line under a card: how often, and the changes', () => {
  assert.equal(summaryOf(direct), 'Every 4 min · no change');
  assert.equal(summaryOf(change), 'Every 5 min · change at Yotsuya');
  assert.equal(summaryOf(change, 'now'), 'Next 10:07am · change at Yotsuya');
});

test('tooltips name the piece, where it goes and how often', () => {
  assert.deepEqual(legTip(direct, 2), {
    lines: [metro], title: 'Marunouchi Line', body: 'Tokyo → Shinjuku-gyoemmae · 15 min',
    meta: 'Tokyo Metro · 3 stops · every 4 min', operator: metro.operator,
  });
  assert.equal(legTip(change, 2).title, 'JR Chuo Rapid Line · Rapid');
  assert.deepEqual(legTip(direct, 1), { title: 'Wait about 2 min', body: 'For the next Marunouchi Line train', meta: 'Trains every 4 min' });
  assert.equal(legTip(direct, 0).body, 'To Tokyo');
  assert.equal(legTip(change, 3).body, 'Change at Yotsuya to the Marunouchi Line');
  const last = legTip(direct, 3, { to: 'Shinjuku Gyoen' });
  assert.equal(last.exit, 'Exit 2');
  assert.equal(last.body, 'Shinjuku-gyoemmae → Shinjuku Gyoen');
  assert.deepEqual(optionTip(change, { to: 'Shinjuku Gyoen', fare: 356 }), {
    lines: [chuo, metro], title: 'JR Chuo Rapid → Marunouchi', body: 'To Shinjuku Gyoen · 25 min · ¥356',
    meta: 'Change at Yotsuya · click to show',
  });
});

test('the journey bar and the steps', () => {
  assert.deepEqual(barOf(change).map((p) => [p.kind, p.minutes, p.colour]), [
    ['walk', 4, ''], ['wait', 2, ''], ['ride', 8, '#F15A22'], ['walk', 3, ''], ['wait', 1, ''], ['ride', 3, '#F62E36'], ['walk', 4, ''],
  ]);
  const steps = stepsOf(direct, { to: 'Shinjuku Gyoen' });
  assert.deepEqual(steps.map((st) => st.kind), ['walk', 'ride', 'walk', 'end']);
  assert.equal(steps[0].text, 'Walk 3 min to Tokyo');
  assert.equal(steps[2].text, 'Walk 4 min to Shinjuku Gyoen');
  assert.equal(steps[2].exit, 'Exit 2');
  assert.equal(stepsOf(change, { to: 'X' })[2].text, 'Change at Yotsuya · 3 min walk');
  assert.deepEqual(linesOf(change).map((l) => l.code), ['JC', 'M']);
  assert.equal(directionOf(change.legs[2]), 'Rapid toward Takao');
  assert.equal(directionOf(direct.legs[2]), 'Toward Ogikubo');
});
