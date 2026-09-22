import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRoute, gapCountry, realRoute, estimateMinutes, suggestMode, travelOptions, drawnMode,
} from '../lib/travel.js';

const JAPAN = 392;
const KOREA = 410;
const CHINA = 156;
const SINGAPORE = 702;

test('each country\'s gaps, as the live API answered', () => {
  assert.equal(canRoute(JAPAN, 'TRANSIT'), false);
  assert.equal(canRoute(JAPAN, 'WALK'), true);
  assert.equal(canRoute(KOREA, 'WALK'), false);
  assert.equal(canRoute(KOREA, 'DRIVE'), false);
  assert.equal(canRoute(KOREA, 'TRANSIT'), true);
  assert.equal(canRoute(CHINA, 'TRANSIT'), false);
  assert.equal(canRoute(SINGAPORE, 'TRANSIT'), true);
  assert.equal(canRoute(null, 'TRANSIT'), true);
  assert.equal(gapCountry(JAPAN), 'Japan');
  assert.equal(gapCountry(SINGAPORE), '');
});

test('a transit route with no line on it is not a train', () => {
  assert.equal(realRoute({ mode: 'TRANSIT', found: true, seconds: 2636, lines: [] }), false);
  assert.equal(realRoute({ mode: 'TRANSIT', found: true, seconds: 723, lines: [{ name: 'NS' }] }), true);
  assert.equal(realRoute({ mode: 'WALK', found: true, seconds: 3244, lines: [] }), true);
  assert.equal(realRoute({ mode: 'DRIVE', found: false }), false);
});

test('estimates are rough but ordered sensibly', () => {
  assert.equal(estimateMinutes(0.36, 'WALK'), 5); // "about 5 min walk", as the app always said
  assert.ok(estimateMinutes(8, 'TRANSIT') < estimateMinutes(8, 'WALK'));
  assert.ok(estimateMinutes(8, 'DRIVE') < estimateMinutes(8, 'TRANSIT'));
  assert.equal(estimateMinutes(0, 'DRIVE'), 5);
});

test('a short hop is a walk, a long one the train — even where the train is only an estimate', () => {
  assert.equal(suggestMode(0.4, SINGAPORE), 'WALK');
  assert.equal(suggestMode(6, SINGAPORE), 'TRANSIT');
  assert.equal(suggestMode(6, JAPAN), 'TRANSIT');
  // Seoul cannot route a walk, so even a short hop goes by what it can route.
  assert.equal(suggestMode(0.4, KOREA), 'TRANSIT');
  assert.equal(drawnMode('off', 6, JAPAN), null);
  assert.equal(drawnMode('auto', 0.4, JAPAN), 'WALK');
  assert.equal(drawnMode('DRIVE', 0.4, JAPAN), 'DRIVE');
});

test('the options for a hop: real where Google has them, estimates where it cannot', () => {
  // Tokyo: walk and drive from Google, transit estimated.
  const tokyo = travelOptions(8.6, JAPAN, {
    WALK: { mode: 'WALK', found: true, seconds: 6393, polyline: 'w' },
    DRIVE: { mode: 'DRIVE', found: true, seconds: 1624, polyline: 'd' },
  });
  assert.deepEqual(tokyo.map((o) => [o.mode, o.minutes, o.estimate]),
    [['WALK', 107, false], ['TRANSIT', estimateMinutes(8.6, 'TRANSIT'), true], ['DRIVE', 27, false]]);
  // Seoul: transit only; the rest estimated.
  const seoul = travelOptions(8, KOREA, { TRANSIT: { mode: 'TRANSIT', found: true, seconds: 1968, lines: [{ name: '2' }] } });
  assert.deepEqual(seoul.map((o) => [o.mode, o.estimate]), [['WALK', true], ['TRANSIT', false], ['DRIVE', true]]);
  // Still asking: shown as waiting, not as missing.
  assert.equal(travelOptions(1, SINGAPORE, {})[0].waiting, true);
  // Nothing found where the way exists: left out.
  const island = travelOptions(20, SINGAPORE, {
    WALK: { mode: 'WALK', found: false }, TRANSIT: { mode: 'TRANSIT', found: false }, DRIVE: { mode: 'DRIVE', found: false },
  });
  assert.deepEqual(island, []);
});
