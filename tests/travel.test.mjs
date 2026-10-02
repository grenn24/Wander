import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRoute, canAsk, gapCountry, whyEstimate, realRoute, estimateMinutes, suggestMode, travelOptions,
  drawnMode, travelNote,
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

test('Japan\'s trains are asked of the app\'s own timetable; Korea\'s walks are not asked at all', () => {
  assert.equal(canAsk(JAPAN, 'TRANSIT'), true);
  assert.equal(canAsk(JAPAN, 'WALK'), true);
  assert.equal(canAsk(KOREA, 'WALK'), false);
  assert.equal(canAsk(CHINA, 'TRANSIT'), false);
  assert.equal(canAsk(SINGAPORE, 'TRANSIT'), true);
  assert.equal(whyEstimate(JAPAN, 'TRANSIT'), 'train timetables cover greater Tokyo only');
  assert.equal(whyEstimate(KOREA, 'DRIVE'), 'Google has no drive routes in South Korea');
  assert.equal(whyEstimate(CHINA, 'TRANSIT'), 'Google has no transit routes in China');
  assert.equal(whyEstimate(SINGAPORE, 'TRANSIT'), '');
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
  const walk = { mode: 'WALK', found: true, seconds: 6393, polyline: 'w' };
  const drive = { mode: 'DRIVE', found: true, seconds: 1624, polyline: 'd' };
  // Tokyo: walk and drive from Google, the train from the timetable, and each says so.
  const tokyo = travelOptions(8.6, JAPAN, {
    WALK: walk,
    TRANSIT: { mode: 'TRANSIT', found: true, source: 'timetable', seconds: 1740, polyline: 't', lines: [{ name: 'Ginza Line' }] },
    DRIVE: drive,
  });
  assert.deepEqual(tokyo.map((o) => [o.mode, o.minutes, o.estimate, o.source]),
    [['WALK', 107, false, 'google'], ['TRANSIT', 29, false, 'timetable'], ['DRIVE', 27, false, 'google']]);
  // Still asking the timetable: waiting, not yet an estimate.
  assert.equal(travelOptions(8.6, JAPAN, { WALK: walk, DRIVE: drive })[1].waiting, true);
  // Osaka: beyond the timetable, so the train is an estimate again.
  const osaka = travelOptions(8.6, JAPAN, { WALK: walk, TRANSIT: { mode: 'TRANSIT', found: false }, DRIVE: drive });
  assert.deepEqual(osaka.map((o) => [o.mode, o.minutes, o.estimate]),
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

test('the note under the hops says where the times came from', () => {
  assert.equal(travelNote({ gaps: [], timetable: false }),
    "Distances are straight-line. Travel times are Google's; ~ marks an estimate.");
  assert.equal(travelNote({ gaps: ['Japan'], timetable: true }),
    "Distances are straight-line. Travel times are Google's, and trains in greater Tokyo are from the operators' timetables; "
    + "~ marks an estimate, where Google can't route that way in Japan.");
});
