import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MODEL_FORMAT, PACE, buildModel, modelJourney, modelRoute, expressName, waitFor, modelLegs,
} from '../lib/railModel.js';
import { walkFor } from '../lib/timetable.js';
import { decodePath } from '../lib/geo.js';

/*
 * A made-up railway, stations 2 km apart:
 *
 *   あ線 (rail, company 0)   0 あ — 1 い — 2 う           108 trains a day each way
 *   う線 (rail, company 0)                  2 う — 4 お    carries on from あ線 at う
 *   い線 (subway, company 1)       1 い — 3 え (north)    36 trains a day
 *   環状線 (one way round)    5 — 6 — 7 — 8 — 5
 *   新幹線                     9 ━━ 10 ━━ 11            fast trains skip 10
 */
const LNG = 0.022; // about 2 km
const hub = (ja, lat, lng) => [ja, '', lat, lng];
const line = (o, ja, k, s, f, r, extra = {}) => ({
  o, ja, en: '', k, loop: 0, s,
  m: s.slice(1).map(() => 2000), f, r, g: s.slice(1).map(() => ''),
  sf: s.map(() => Math.max(...f)), sr: s.map(() => Math.max(...r)), ...extra,
});
function railway() {
  return {
    format: MODEL_FORMAT,
    operators: ['甲', '乙', '丙'],
    hubs: [
      hub('あ', 35, 135), hub('い', 35, 135 + LNG), hub('う', 35, 135 + 2 * LNG),
      hub('え', 35.018, 135 + LNG), hub('お', 35, 135 + 3 * LNG),
      hub('か', 36, 135), hub('き', 36, 135 + LNG), hub('く', 36.018, 135 + LNG), hub('け', 36.018, 135),
      hub('こ', 37, 135), hub('さ', 37, 135.5), hub('し', 37, 136),
    ],
    lines: [
      line(0, 'あ線', 'rail', [0, 1, 2], [108, 108], [108, 108]),
      line(1, 'い線', 'subway', [1, 3], [36], [36]),
      line(0, 'う線', 'rail', [2, 4], [108], [108]),
      { ...line(2, '環状線', 'rail', [5, 6, 7, 8, 5], [108, 108, 108, 108], [0, 0, 0, 0]), loop: 1 },
      {
        o: 2, ja: '新幹線', en: 'Shinkansen', k: 'shinkansen', s: [9, 10, 11],
        t: [0, 30, 60], tier: [1, 3, 1], ph: [6, 2, 6],
        parts: [[1, '東の新幹線', 'East Shinkansen'], [2, '西の新幹線', 'West Shinkansen']],
      },
    ],
  };
}
const near = (data, h) => ({ lat: data.hubs[h][2] + 0.0001, lng: data.hubs[h][3] });
const ride = (km, kind = 'rail') => PACE[kind].stop + (km / PACE[kind].kmh) * 60;
const access = walkFor(0.011) + 2;
const exit = walkFor(0.011) + 1;

test('waiting is half the gap between trains, but never more than half an hour', () => {
  assert.equal(waitFor(108), 5);
  assert.equal(waitFor(36), 15);
  assert.equal(waitFor(8), 30);
});

test('a change of line costs the walk between platforms and the wait for the next train', () => {
  const data = railway();
  const model = buildModel(data);
  const j = modelJourney(model, near(data, 0), near(data, 3));
  const r = modelRoute(model, j);
  assert.deepEqual(r.lines.map((l) => [l.ja, l.from, l.to]), [['あ線', 'あ', 'い'], ['い線', 'い', 'え']]);
  const expected = access + waitFor(108) + ride(2) + 4 + waitFor(36) + ride(2, 'subway') + exit;
  assert.ok(Math.abs(j.minutes - expected) < 0.01, `${j.minutes} vs ${expected}`);
  assert.equal(r.source, 'model');
  assert.deepEqual(r.lines.map((l) => l.vehicle), ['RAIL', 'SUBWAY']);
});

test('a train that runs on into the company\'s next line is stayed on, not changed', () => {
  const data = railway();
  const model = buildModel(data);
  const j = modelJourney(model, near(data, 0), near(data, 4));
  const r = modelRoute(model, j);
  assert.deepEqual(r.lines.map((l) => [l.ja, l.through]), [['あ線', false], ['う線', true]]);
  const expected = access + waitFor(108) + 3 * ride(2) + 1 + exit;
  assert.ok(Math.abs(j.minutes - expected) < 0.01, `${j.minutes} vs ${expected}`);
});

test('a one-way loop is ridden round, past where it began', () => {
  const data = railway();
  const model = buildModel(data);
  // From け (8) to き (6): only forwards, so round through か (5).
  const r = modelRoute(model, modelJourney(model, near(data, 8), near(data, 6)));
  assert.deepEqual(r.lines.map((l) => [l.ja, l.from, l.to]), [['環状線', 'け', 'き']]);
  const path = decodePath(r.polyline);
  assert.ok(path.some((p) => Math.abs(p.lat - 36) < 0.001 && Math.abs(p.lng - 135) < 0.001), 'passes か');
});

test('a Shinkansen journey goes at the pace of the fastest train stopping at both ends', () => {
  const data = railway();
  const model = buildModel(data);
  const end = modelJourney(model, near(data, 9), near(data, 11));
  assert.ok(Math.abs(end.minutes - (access + 5 + 60 + exit)) < 0.01, String(end.minutes));
  // さ is all-stations only: slower, and fewer trains.
  const middle = modelJourney(model, near(data, 9), near(data, 10));
  assert.ok(Math.abs(middle.minutes - (access + 15 + 30 * 1.4 + exit)) < 0.01, String(middle.minutes));
  // And named by the line it is on.
  assert.deepEqual(modelRoute(model, middle).lines.map((l) => l.name), ['East Shinkansen']);
  assert.deepEqual(modelRoute(model, end).lines.map((l) => l.name), ['Shinkansen']);
  const sh = data.lines[4];
  assert.equal(expressName(sh, 1, 2).en, 'West Shinkansen');
  assert.equal(expressName(sh, 2, 1).en, 'West Shinkansen');
});

test('nowhere near a station, no journey; and walking alone is never a train', () => {
  const data = railway();
  const model = buildModel(data);
  assert.equal(modelJourney(model, { lat: 40, lng: 140 }, near(data, 1)), null);
  // Two points by the same station still need a train, so the answer rides one.
  const j = modelJourney(model, near(data, 0), { lat: 35.0002, lng: 135 });
  assert.ok(j === null || modelRoute(model, j).lines.length >= 1);
});

/*
 * The shipped network, built by scripts/transit/build-japan.mjs.
 */
const japan = JSON.parse(readFileSync(new URL('../data/transit/japan-rail.json', import.meta.url), 'utf8'));
const model = buildModel(japan);
const go = (from, to) => {
  const j = modelJourney(model, from, to);
  return j && { ...modelRoute(model, j), minutes: j.minutes };
};

test('Japan: the shipped network is whole and in Japan', () => {
  assert.equal(japan.format, MODEL_FORMAT);
  assert.ok(japan.hubs.length > 8000, `${japan.hubs.length} stations`);
  japan.hubs.forEach(([ja, , lat, lng]) => assert.ok(lat > 24 && lat < 46 && lng > 122 && lng < 146, `${ja} at ${lat},${lng}`));
  japan.lines.filter((l) => l.k !== 'shinkansen').forEach((l) => {
    const hops = l.s.length - 1;
    assert.ok([l.m, l.f, l.r, l.g].every((a) => a.length === hops), `${l.ja} hop arrays`);
    assert.equal(l.sf.length, l.s.length, `${l.ja} stopping counts`);
  });
  assert.equal(japan.lines.filter((l) => l.k === 'shinkansen').length, 8);
});

test('Japan: journeys anyone could check against a departure board', () => {
  // Kyoto Station to Fushimi Inari: the JR Nara Line, a few stops.
  const inari = go({ lat: 34.9858, lng: 135.7588 }, { lat: 34.9671, lng: 135.7727 });
  assert.equal(inari.lines[0].ja, '奈良線');
  assert.ok(inari.minutes > 8 && inari.minutes < 25, String(inari.minutes));
  // Tokyo to Kyoto: the Tokaido Shinkansen, about two and a quarter hours.
  const kyoto = go({ lat: 35.6812, lng: 139.7671 }, { lat: 34.9858, lng: 135.7588 });
  assert.deepEqual(kyoto.lines.map((l) => l.name), ['Tokaido Shinkansen']);
  assert.ok(kyoto.minutes > 130 && kyoto.minutes < 155, String(kyoto.minutes));
  // Hakata to Kagoshima-Chuo on the Kyushu Shinkansen.
  const kagoshima = go({ lat: 33.5897, lng: 130.4207 }, { lat: 31.5840, lng: 130.5414 });
  assert.equal(kagoshima.lines[0].name, 'Kyushu Shinkansen');
  assert.ok(kagoshima.minutes > 80 && kagoshima.minutes < 110, String(kagoshima.minutes));
  // Namba to Universal Studios: Hanshin to Nishikujō, then the JR Yumesaki Line.
  const usj = go({ lat: 34.6659, lng: 135.5013 }, { lat: 34.6654, lng: 135.4323 });
  assert.equal(usj.lines[usj.lines.length - 1].ja, '桜島線');
  // Okinawa has a monorail but no line to the mainland.
  assert.equal(go({ lat: 35.6812, lng: 139.7671 }, { lat: 26.2124, lng: 127.6792 }), null);
});

test('Japan: where real timetables exist, the model agrees with them', async () => {
  // The same comparison scripts/transit/calibrate.mjs fits PACE by, on a smaller sample.
  const { samplePairs, score } = await import('../scripts/transit/calibrate.mjs');
  const { error, median } = score(samplePairs(120), PACE);
  assert.ok(error < 0.12, `mean |log ratio| ${error.toFixed(3)}`);
  assert.ok(median > 0.93 && median < 1.07, `median ratio ${median.toFixed(3)}`);
});

test('Japan: and outside Tokyo, it agrees with the open timetables on board', async () => {
  const { regionalPairs, regionalScore } = await import('../scripts/transit/calibrate.mjs');
  const byKind = regionalScore(regionalPairs(30), PACE);
  for (const [kind, { median }] of Object.entries(byKind)) {
    assert.ok(median > 0.8 && median < 1.25, `${kind}: median ratio ${median.toFixed(2)}`);
  }
});

test('a partial timetable is taken unless it is clearly slower than the estimate', async () => {
  const { preferTimetable } = await import('../lib/japanTransit.js');
  const timed = (min) => ({ found: true, seconds: min * 60 });
  assert.equal(preferTimetable(timed(20), timed(18)), true);
  assert.equal(preferTimetable(timed(30), timed(18)), false);
  // Leaving now, the timetable's real wait is allowed for.
  assert.equal(preferTimetable(timed(26), timed(18), true), true);
  assert.equal(preferTimetable(timed(20), null), true);
  assert.equal(preferTimetable({ found: false }, timed(18)), false);
  assert.equal(preferTimetable(null, timed(18)), false);
});

test('Fukuoka: the model, fitted in Tokyo, agrees with a real timetable elsewhere', async () => {
  const { buildNetwork, typicalJourney } = await import('../lib/timetable.js');
  const data = JSON.parse(readFileSync(new URL('../data/transit/open-rail.json', import.meta.url), 'utf8'));
  const net = buildNetwork(data, 'weekday');
  const at = (name) => { const s = data.stops.find((x) => x[0] === name); return { lat: s[1], lng: s[2] }; };
  for (const [a, b] of [['Tenjin', 'Hakata'], ['Meinohama', 'Kaizuka'], ['Fukuoka Airport', 'Tenjin'], ['Hashimoto', 'Hakata']]) {
    const real = typicalJourney(net, at(a), at(b));
    const estimate = go(at(a), at(b));
    const gap = Math.abs(estimate.minutes - (real.arrives - real.leaves));
    assert.ok(gap <= 8, `${a} to ${b}: model ${estimate.minutes.toFixed(0)} vs timetable ${real.arrives - real.leaves}`);
  }
});

test('a train that loses to walking is not offered: the walk is', async () => {
  const { onFoot } = await import('../lib/japanTransit.js');
  // Kiyomizu-dera to Gion, 1.3 km: a 42-minute train journey against a walk of about 21.
  const kiyomizu = { lat: 34.9949, lng: 135.7850 };
  const gion = { lat: 35.0037, lng: 135.7756 };
  const slow = { mode: 'TRANSIT', found: true, source: 'model', seconds: 42 * 60, lines: [{ name: 'Keihan Main Line' }] };
  const walk = onFoot(kiyomizu, gion, slow);
  assert.equal(walk.source, 'walk');
  assert.deepEqual(walk.lines, []);
  assert.ok(walk.seconds < slow.seconds && walk.seconds > 10 * 60, String(walk.seconds));
  // A train that saves time stands, and so does no train at all.
  const quick = { ...slow, seconds: 8 * 60 };
  assert.equal(onFoot(kiyomizu, gion, quick), quick);
  assert.equal(onFoot(kiyomizu, gion, null), null);
  assert.deepEqual(onFoot(kiyomizu, gion, { found: false }), { found: false });
});

/*
 * Other ways than the quickest, and a journey read back as legs: walks,
 * waits and rides, whose minutes add up to the journey's.
 */
test('Japan: a journey can leave lines out or avoid changing, and reads back as legs', () => {
  // Osaka Station to Dōtonbori: the Midōsuji Line, or the Yotsubashi, or the loop line and a walk.
  const umeda = { lat: 34.7025, lng: 135.4959 };
  const dotonbori = { lat: 34.6687, lng: 135.5013 };
  const fastest = modelJourney(model, umeda, dotonbori);
  const legs = modelLegs(model, fastest);
  const total = legs.reduce((s, l) => s + l.minutes, 0);
  assert.ok(Math.abs(total - fastest.minutes) <= 1, `${total} against ${fastest.minutes}`);
  assert.equal(legs[0].kind, 'walk');
  assert.equal(legs[legs.length - 1].kind, 'walk');
  const rides = (ls) => ls.filter((l) => l.kind === 'ride');
  assert.ok(rides(legs).length > 0);
  rides(legs).forEach((r) => {
    assert.ok(Number.isInteger(r.lineIndex));
    assert.ok(r.stops.length >= 2, 'a ride passes at least two stations');
    assert.equal(r.stops[0], r.from);
    assert.equal(r.stops[r.stops.length - 1], r.to);
  });

  const used = new Set(rides(legs).map((r) => r.lineIndex));
  const other = modelJourney(model, umeda, dotonbori, { avoid: used });
  assert.ok(other, 'there is another way');
  rides(modelLegs(model, other)).forEach((r) => assert.ok(!used.has(r.lineIndex)));

  const changes = (j) => rides(modelLegs(model, j)).filter((r) => !r.through).length - 1;
  const calm = modelJourney(model, umeda, dotonbori, { change: 30 });
  assert.ok(changes(calm) <= changes(fastest));
  // The cost of changing steers the search; it is not time anyone spends.
  const calmTotal = modelLegs(model, calm).reduce((s, l) => s + l.minutes, 0);
  assert.ok(Math.abs(calmTotal - calm.minutes) <= 1, `${calmTotal} against ${calm.minutes}`);
});
