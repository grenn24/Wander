/*
 * The ways to go by train between two points in Japan, for comparing: the
 * fastest, the same journey with each of its lines left out, and the one
 * with fewest changes — each read into one shape whichever planner found it,
 * the timetable's (lib/timetable) or the network model's (lib/railModel).
 *
 * An option is
 *
 *   { id, seconds, source, lines: [name], tags: [tag], changes, fare, legs }
 *
 * where `id` is its lines' ids joined by '>', which is also what a saved
 * route remembers, and each leg is one of
 *
 *   { kind: 'walk', minutes, from, to, exit, polyline, change? }
 *   { kind: 'wait', minutes }
 *   { kind: 'ride', minutes, line, type, from, to, toward, stops: [{ name, time }],
 *     leaves, arrives, every, next, platform, through, polyline }
 *
 * `line` is { id, name, code, colour, shape, operator, vehicle }; times are
 * minutes of the service day, and null where the model has no timetable.
 * Nothing here knows about files, Next or the DOM.
 */

import { earliestJourney, typicalJourney, TYPICAL, encodePath } from './timetable.js';
import { modelJourney, modelLegs, expressName } from './railModel.js';
import { operatorOf, isJR } from './operators.js';
import { timetableCode, modelCode } from './lineCodes.js';

// At most this many options, and none slower than the fastest by more than SLACK.
const MOST = 4;
const slack = (fastest) => Math.max(15 * 60, fastest * 0.5);
// What a change costs when looking for the way with fewest: minutes.
const CALM = 12;

/* ---------------------------------------------------------------- lines -- */

const VEHICLE = { rail: 'RAIL', subway: 'SUBWAY', monorail: 'MONORAIL', tram: 'TRAM', shinkansen: 'HIGH_SPEED_TRAIN' };

/** A timetable line as an option names it. */
export function timetableLine(net, index) {
  const [name, colour, vehicle, operatorName, code] = net.lines[index];
  const operator = operatorOf({ operator: operatorName, line: name });
  return {
    id: name,
    name,
    code: code || timetableCode(name),
    colour: colour ? `#${colour}` : '',
    shape: isJR(operator) || /^JR /.test(name) ? 'square' : 'round',
    operator,
    vehicle: vehicle || 'RAIL',
  };
}

/** A line of the network model, named for the part ridden where it has parts (the Tōkaidō and San'yō Shinkansen). */
export function modelLine(model, index, express = null) {
  const l = model.lines[index];
  const named = express ? expressName(l, express[0], express[1]) : l;
  const operatorName = model.operators[l.o];
  const operator = operatorOf({ operator: operatorName });
  const id = `${operatorName}|${named.ja}`;
  const [code, colour] = modelCode(`${operatorName}|${l.ja}`);
  return {
    id,
    name: named.en || named.ja,
    code: l.code || code,
    colour: l.c ? `#${l.c}` : colour ? `#${colour}` : '',
    shape: isJR(operator) ? 'square' : 'round',
    operator,
    vehicle: VEHICLE[l.k] || 'RAIL',
  };
}

/* ------------------------------------------------------------ timetable -- */

/*
 * How often trains run where a ride boards: the trains of the same line
 * leaving that stop for the same next stop within half an hour either side,
 * or an hour and a half where that finds fewer than two.
 */
function everyFrom(net, ride) {
  const { legs } = net;
  const [here, next] = ride.stops;
  if (next == null) return null;
  const count = (half) => {
    let lo = 0;
    let hi = legs.count;
    const start = ride.leaves - half;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (legs.dep[mid] < start) lo = mid + 1; else hi = mid; }
    let n = 0;
    for (let c = lo; c < legs.count && legs.dep[c] <= ride.leaves + half; c += 1) {
      if (legs.from[c] === here && legs.to[c] === next) n += 1;
    }
    return n;
  };
  let n = count(30);
  if (n >= 2) return Math.max(1, Math.round(60 / n));
  n = count(90);
  return n >= 1 ? Math.max(1, Math.round(180 / n)) : null;
}

function timetableLegs(net, journey, now) {
  const at = (s) => (s === 'start' ? journey.from : s === 'end' ? journey.to : net.stops[s]);
  const name = (s) => (s === 'start' || s === 'end' ? null : net.stops[s].name);
  const point = (s) => { const p = at(s); return { lat: p.lat, lng: p.lng }; };
  const out = [];
  let clock = journey.leaves;
  journey.legs.forEach((leg) => {
    if (leg.kind === 'walk') {
      if (leg.minutes > 0) {
        out.push({
          kind: 'walk', minutes: leg.minutes, from: name(leg.from), to: name(leg.to), exit: null,
          change: leg.from !== 'start' && leg.to !== 'end',
          polyline: encodePath([point(leg.from), point(leg.to)]),
        });
      }
      clock += leg.minutes;
      return;
    }
    const wait = leg.leaves - clock;
    if (wait > 0 && !leg.through) out.push({ kind: 'wait', minutes: wait });
    out.push({
      kind: 'ride',
      minutes: leg.arrives - leg.leaves + (leg.through ? Math.max(0, wait) : 0),
      line: timetableLine(net, leg.lineIndex),
      type: leg.type || '',
      from: net.stops[leg.from].name,
      to: net.stops[leg.to].name,
      toward: leg.toward,
      stops: leg.stops.slice(1, -1).map((s, i) => ({ name: net.stops[s].name, time: leg.times[i + 1] })),
      leaves: leg.leaves,
      arrives: leg.arrives,
      every: everyFrom(net, leg),
      next: now ? leg.leaves : null,
      platform: null,
      through: !!leg.through,
      polyline: encodePath(leg.stops.map(point).filter((p) => p.lat != null)),
    });
    clock = leg.arrives;
  });
  return out;
}

/**
 * The options by timetable: leaving at `minute` (today's timetable), or a
 * typical weekday late morning where it is null.
 *
 *   prefer  a saved route's line ids: that route first, with fresh times
 *
 * Returns { options, journeys, preferMissing }, the journeys beside their
 * options for drawing the answer the old way (asRoute).
 */
export function timetableOptions(net, from, to, { minute = null, prefer = null } = {}) {
  const plan = (choices) => (minute == null
    ? typicalJourney(net, from, to, TYPICAL, choices)
    : earliestJourney(net, from, to, minute, choices));
  const first = plan({});
  if (!first) return { options: [], journeys: [], preferMissing: false };
  const used = [...new Set(first.legs.filter((l) => l.kind === 'ride').map((l) => l.lineIndex))];
  const tries = [first, ...used.map((li) => plan({ avoid: new Set([li]) }))];
  if (used.length > 1) tries.push(plan({ avoid: new Set(used) }));
  tries.push(plan({ change: CALM }));

  let preferId = null;
  if (prefer && prefer.length) {
    preferId = prefer.join('>');
    const only = new Set(prefer.map((id) => net.lines.findIndex((l) => l[0] === id)).filter((i) => i >= 0));
    if (only.size) tries.push(plan({ only }));
  }
  const now = minute != null;
  return choose(tries.filter(Boolean).map((journey) => ({
    journey,
    option: optionOf('timetable', timetableLegs(net, journey, now), (journey.arrives - journey.leaves) * 60),
  })), preferId);
}

/* ---------------------------------------------------------------- model -- */

const nameOf = (x) => x.en || x.ja;
const SERVICE_MINUTES = 18 * 60;

// Minutes between trains where a ride boards, from the trains a day each way (or an hour, on a Shinkansen).
function modelEvery(model, ride) {
  const l = model.lines[ride.lineIndex];
  if (ride.express) {
    const ph = Math.min(l.ph[ride.express[0]], l.ph[ride.express[1]]);
    return ph > 0 ? Math.max(1, Math.round(60 / ph)) : null;
  }
  const i = l.s.indexOf(ride.from);
  if (i < 0) return null;
  const count = ride.forwards ? l.f[i] : l.r[i - 1];
  return count > 0 ? Math.max(1, Math.round(SERVICE_MINUTES / count)) : null;
}

function modelOptionLegs(model, journey) {
  const { hubs, lines } = model;
  const name = (h) => (h === 'start' || h === 'end' || h == null ? null : nameOf(hubs[h]));
  const at = (h) => (h === 'start' ? journey.from : h === 'end' ? journey.to : hubs[h]);
  const point = (h) => { const p = at(h); return { lat: p.lat, lng: p.lng }; };
  // Whole minutes that still add up: each leg ends where the running total, rounded, ends.
  let before = 0;
  const whole = (m) => { const start = Math.round(before); before += m; return Math.round(before) - start; };
  return modelLegs(model, journey).map((leg) => {
    const minutes = whole(leg.minutes);
    if (leg.kind === 'wait') return { kind: 'wait', minutes };
    if (leg.kind === 'walk') {
      return {
        kind: 'walk', minutes, from: name(leg.from), to: name(leg.to), exit: null,
        change: !!leg.change || (leg.from !== 'start' && leg.to !== 'end'),
        polyline: leg.from === leg.to ? '' : encodePath([point(leg.from), point(leg.to)]),
      };
    }
    const l = lines[leg.lineIndex];
    const forwards = leg.forwards !== false;
    return {
      kind: 'ride',
      minutes,
      line: modelLine(model, leg.lineIndex, leg.express),
      type: '',
      from: name(leg.from),
      to: name(leg.to),
      toward: name(l.loop ? leg.to : forwards ? l.s[l.s.length - 1] : l.s[0]),
      stops: leg.stops.slice(1, -1).map((h) => ({ name: name(h), time: null })),
      leaves: null,
      arrives: null,
      every: modelEvery(model, leg),
      next: null,
      platform: null,
      through: !!leg.through,
      polyline: encodePath(leg.points.map((p) => ({ lat: p.lat, lng: p.lng }))),
    };
  }).filter((leg) => leg.kind === 'ride' || leg.minutes > 0);
}

/** The options by the network model, where there is no timetable: estimates, the same shape. */
export function modelOptions(model, from, to, { prefer = null } = {}) {
  const first = modelJourney(model, from, to);
  if (!first) return { options: [], journeys: [], preferMissing: false };
  const used = [...new Set(modelLegs(model, first).filter((l) => l.kind === 'ride').map((l) => l.lineIndex))];
  const tries = [first, ...used.map((li) => modelJourney(model, from, to, { avoid: new Set([li]) }))];
  if (used.length > 1) tries.push(modelJourney(model, from, to, { avoid: new Set(used) }));
  tries.push(modelJourney(model, from, to, { change: CALM }));

  let preferId = null;
  if (prefer && prefer.length) {
    preferId = prefer.join('>');
    const only = new Set(prefer.map((id) => model.lines.findIndex((l) => `${model.operators[l.o]}|${l.ja}` === id)).filter((i) => i >= 0));
    if (only.size) tries.push(modelJourney(model, from, to, { only }));
  }
  return choose(tries.filter(Boolean).map((journey) => ({
    journey,
    option: optionOf('model', modelOptionLegs(model, journey), Math.round(journey.minutes) * 60),
  })), preferId);
}

/* -------------------------------------------------------------- choosing -- */

function optionOf(source, legs, seconds) {
  const rides = legs.filter((l) => l.kind === 'ride');
  const names = [];
  rides.forEach((r) => { if (names[names.length - 1] !== r.line.name) names.push(r.line.name); });
  return {
    id: rides.map((r) => r.line.id).join('>'),
    seconds,
    source,
    lines: names,
    tags: [],
    changes: Math.max(0, rides.filter((r) => !r.through).length - 1),
    fare: null,
    legs,
  };
}

/*
 * One option per way of going, the slow ones dropped, fastest first — except
 * a saved route, which comes first whenever it runs.
 */
function choose(found, preferId) {
  const byId = new Map();
  found.forEach((f) => {
    if (!f.option.id) return;
    const had = byId.get(f.option.id);
    if (!had || had.option.seconds > f.option.seconds) byId.set(f.option.id, f);
  });
  let list = [...byId.values()].sort((a, b) => a.option.seconds - b.option.seconds);
  if (!list.length) return { options: [], journeys: [], preferMissing: !!preferId };
  const fastest = list[0].option.seconds;
  const saved = preferId ? list.find((f) => f.option.id === preferId) : null;
  list = list.filter((f) => f === saved || f.option.seconds <= fastest + slack(fastest));
  const rest = list.filter((f) => f !== saved).slice(0, saved ? MOST - 1 : MOST);
  list = saved ? [saved, ...rest] : rest;

  const options = list.map((f) => f.option);
  const fastestOption = options.reduce((a, b) => (b.seconds < a.seconds ? b : a));
  const jrOnly = (o) => o.legs.some((l) => l.kind === 'ride')
    && o.legs.every((l) => l.kind !== 'ride' || isJR(l.line.operator));
  const someNot = options.some((o) => !jrOnly(o));
  options.forEach((o) => {
    o.tags = [];
    if (o === saved?.option) o.tags.push('saved');
    if (o === fastestOption) o.tags.push('fastest');
    if (o.changes > 0) o.tags.push(`changes:${o.changes}`);
    if (someNot && jrOnly(o)) o.tags.push('jr-only');
  });
  return { options, journeys: list.map((f) => f.journey), preferMissing: !!preferId && !saved };
}
