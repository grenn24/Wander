/*
 * Train journeys from published timetables, for where Google has none.
 *
 * Google's Routes API has no transit in Japan (see lib/travel), though the
 * timetables themselves are public: the operators publish them through the
 * Public Transportation Open Data Center, and the mini-tokyo-3d project
 * gathers every urban railway in greater Tokyo into one set of files.
 * scripts/transit/build-tokyo.mjs packs those into data/transit/, and this
 * plans journeys over them the way a route planner does: real trains, real
 * departure times, changes between lines, and trains that run through from
 * one operator's line onto another's without anyone getting off.
 *
 * The planner is a connection scan (Dibbelt, Pajor, Strasser and Wagner,
 * "Connection Scan Algorithm", 2013): every leg of every train, sorted by
 * departure, read once from the time you leave. Over a weekday's 590,000 legs
 * it answers in a few milliseconds, which is why it can run per request on
 * the server with no routing service behind it.
 *
 * Nothing here knows about files, Next or the DOM, so the build script, the
 * server and node --test all use it as it is.
 */

import { encodePath, decodePath } from './polyline.js';

export { encodePath, decodePath };

export const FORMAT = 1;

/* ---------------------------------------------------------------- format -- */

/*
 * The data file is mostly numbers, and as JSON arrays it came to twice the
 * size. So the two big parts are strings of base-62 digits: each train is a
 * fixed nine characters, and each run of times is one character per minute
 * value, which is almost always under an hour.
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALUE = new Map([...DIGITS].map((c, i) => [c, i]));
// A value this large or larger is written as this digit and then two more.
const LONG = 61;

function fixed(n, width) {
  if (!Number.isInteger(n) || n < 0 || n >= 62 ** width) throw new RangeError(`${n} does not fit in ${width} digits`);
  let s = '';
  for (let i = 0; i < width; i += 1) { s = DIGITS[n % 62] + s; n = Math.floor(n / 62); }
  return s;
}

function readFixed(s, at, width) {
  let n = 0;
  for (let i = 0; i < width; i += 1) n = n * 62 + VALUE.get(s[at + i]);
  return n;
}

/** Minute values (each 0 or more) as a string, one character apiece when under 61. */
export function packTiming(values) {
  return values.map((v) => (v < LONG ? DIGITS[v] : DIGITS[LONG] + fixed(v - LONG, 2))).join('');
}

export function unpackTiming(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    const v = VALUE.get(s[i]);
    if (v < LONG) out.push(v);
    else { out.push(LONG + readFixed(s, i + 1, 2)); i += 2; }
  }
  return out;
}

// seq (2 digits), timing (3), start minute (2), train type (2).
export const TRAIN_WIDTH = 9;

export function packTrain({ seq, timing, start, type }) {
  return fixed(seq, 2) + fixed(timing, 3) + fixed(start, 2) + fixed(type, 2);
}

export function unpackTrain(s, i) {
  const at = i * TRAIN_WIDTH;
  return {
    seq: readFixed(s, at, 2),
    timing: readFixed(s, at + 2, 3),
    start: readFixed(s, at + 5, 2),
    type: readFixed(s, at + 7, 2),
  };
}

/* ------------------------------------------------------------ distances -- */

export function haversineKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/*
 * Walking between two points: 4.5 km/h, as everywhere else in the app, over a
 * quarter as far again as the straight line, because streets are not straight.
 */
const WALK_KMH = 4.5;
const DETOUR = 1.25;
export const walkFor = (km) => Math.max(1, Math.round((km * DETOUR / WALK_KMH) * 60));

/*
 * The rules a planner needs and a timetable does not say. Minutes.
 *
 * Changing trains at the same platform takes a minute; between two lines in
 * one station, four, which is about what Japanese planners allow for the big
 * interchanges; between two stations of one complex (the Ginza Line to the
 * Hanzomon Line at Shibuya) the walk, with three minutes of stairs, and never
 * less than six. Two stations that are merely near each other are a street
 * walk apart, with time to leave one and enter the other.
 */
const SAME_PLATFORM = 1;
const SAME_STATION = 4;
const SAME_COMPLEX = 6;
const COMPLEX_STAIRS = 3;
const STREET_STAIRS = 4;
const STREET_KM = 0.5;
// Getting from the street to a platform; the way out is quicker.
const IN = 2;
const OUT = 1;

/* ------------------------------------------------------------- network -- */

/**
 * One day's timetable, unpacked into the arrays the scan reads.
 *
 *   data  the parsed data file
 *   day   'weekday' or 'weekend'
 */
export function buildNetwork(data, day) {
  if (!data || data.format !== FORMAT) throw new Error('Unknown timetable format.');
  const service = data.days[day];
  if (!service) throw new Error(`No ${day} timetable.`);

  const stops = data.stops.map(([name, lat, lng, line, group, place, zone = -1]) => ({
    name, lat, lng, line, group, place, zone, exits: null,
  }));
  // Its ways out, where the timetable's source lists them (greater Tokyo's subways, mostly).
  (data.exits || []).forEach(([stop, label, lat, lng]) => {
    (stops[stop].exits = stops[stop].exits || []).push({ label, lat, lng });
  });
  const seqs = data.seqs;
  const timings = data.timings.map(unpackTiming);
  const count = service.trains.length / TRAIN_WIDTH;

  // Train by train, the legs between consecutive stops.
  const trains = [];
  let legs = 0;
  for (let i = 0; i < count; i += 1) {
    const t = unpackTrain(service.trains, i);
    trains.push(t);
    legs += seqs[t.seq].length - 1;
  }

  const from = new Uint16Array(legs);
  const to = new Uint16Array(legs);
  const dep = new Uint16Array(legs);
  const arr = new Uint16Array(legs);
  const trip = new Int32Array(legs);
  const last = new Uint8Array(legs);
  let n = 0;
  trains.forEach((t, i) => {
    const seq = seqs[t.seq];
    const times = timings[t.timing];
    let leaves = t.start;
    for (let k = 1; k < seq.length; k += 1) {
      const reaches = leaves + times[2 * (k - 1)];
      from[n] = seq[k - 1]; to[n] = seq[k];
      dep[n] = leaves; arr[n] = reaches;
      trip[n] = i;
      last[n] = k === seq.length - 1 ? 1 : 0;
      n += 1;
      leaves = reaches + times[2 * (k - 1) + 1];
    }
  });

  /*
   * In order of departure, then of arrival, then as listed — so that of two
   * legs leaving in the same minute, one that arrives in that minute and so
   * could feed the other is read first.
   */
  const order = new Float64Array(legs);
  const SLOT = 2 ** 21;
  if (legs >= SLOT) throw new RangeError('Too many legs for one day.');
  for (let c = 0; c < legs; c += 1) order[c] = (dep[c] * 4096 + arr[c]) * SLOT + c;
  order.sort();
  const byTime = (src) => {
    const out = new src.constructor(legs);
    for (let c = 0; c < legs; c += 1) out[c] = src[order[c] % SLOT];
    return out;
  };

  const sorted = {
    count: legs, from: byTime(from), to: byTime(to), dep: byTime(dep),
    arr: byTime(arr), trip: byTime(trip), last: byTime(last),
  };

  // Each train's legs in order, for reading a journey back: offsets into one array.
  const ownStart = new Int32Array(count + 1);
  for (let c = 0; c < legs; c += 1) ownStart[sorted.trip[c] + 1] += 1;
  for (let i = 0; i < count; i += 1) ownStart[i + 1] += ownStart[i];
  const own = new Int32Array(legs);
  const filled = ownStart.slice(0, count);
  for (let c = 0; c < legs; c += 1) own[filled[sorted.trip[c]]++] = c;

  // Trains that carry on as another train: the Hanzomon Line into the Den-en-toshi Line.
  const nextOf = new Map();
  const through = service.through || [];
  for (let i = 0; i < through.length; i += 2) {
    const a = through[i];
    if (!nextOf.has(a)) nextOf.set(a, []);
    nextOf.get(a).push(through[i + 1]);
  }

  return {
    day,
    stops,
    lines: data.lines,
    types: data.types,
    // Fares by zone, where the timetable's publishers give them (the open feeds).
    fares: data.fares || [],
    trains,
    nextOf,
    legs: sorted,
    own: { start: ownStart, legs: own },
    walks: walksBetween(stops),
    grid: gridOf(stops),
  };
}

/*
 * Where you can walk from each stop, and how long it takes, as two flat
 * arrays indexed by a third: a day's scan follows these thousands of times.
 */
function walksBetween(stops) {
  const grid = gridOf(stops);
  const lists = stops.map(() => []);
  stops.forEach((a, i) => {
    if (a.lat == null) return;
    nearby(grid, stops, a, Math.max(STREET_KM, 1.2)).forEach(({ index: j, km }) => {
      if (i === j) return;
      const b = stops[j];
      const sameGroup = a.group >= 0 && a.group === b.group;
      let minutes;
      if (sameGroup && a.place === b.place) minutes = Math.max(SAME_STATION, walkFor(km));
      else if (sameGroup) minutes = Math.max(SAME_COMPLEX, walkFor(km) + COMPLEX_STAIRS);
      else if (km <= STREET_KM) minutes = walkFor(km) + STREET_STAIRS;
      else return;
      lists[i].push([j, minutes]);
    });
  });
  const start = new Int32Array(stops.length + 1);
  lists.forEach((l, i) => { start[i + 1] = start[i] + l.length; });
  const to = new Uint16Array(start[stops.length]);
  const minutes = new Uint16Array(start[stops.length]);
  lists.forEach((l, i) => l.forEach(([j, m], k) => { to[start[i] + k] = j; minutes[start[i] + k] = m; }));
  return { start, to, minutes };
}

// Stops filed by a hundredth of a degree, about a kilometre, so "what is near" reads a few cells.
const CELL = 0.01;
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)},${Math.floor(lng / CELL)}`;

function gridOf(stops) {
  const grid = new Map();
  stops.forEach((s, i) => {
    if (s.lat == null) return;
    const key = cellKey(s.lat, s.lng);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  return grid;
}

/** Stops within km of a point, nearest first. */
function nearby(grid, stops, point, km) {
  const reach = Math.ceil(km / (CELL * 111 * Math.cos(point.lat * Math.PI / 180))) + 1;
  const row = Math.floor(point.lat / CELL);
  const col = Math.floor(point.lng / CELL);
  const out = [];
  for (let r = row - reach; r <= row + reach; r += 1) {
    for (let c = col - reach; c <= col + reach; c += 1) {
      (grid.get(`${r},${c}`) || []).forEach((index) => {
        const d = haversineKm(point, stops[index]);
        if (d <= km) out.push({ index, km: d });
      });
    }
  }
  return out.sort((a, b) => a.km - b.km);
}

/*
 * The stations worth walking to from a point: every one within a quarter of
 * an hour's walk, or, where there is none so close (Hakone, the far end of a
 * branch line), the nearest few within three kilometres. Nothing at all means
 * the point is outside what the timetable covers.
 */
const NEAR_KM = 1.0;
const FAR_KM = 3.0;
const FEWEST = 3;

export function stationsNear(net, point) {
  const all = nearby(net.grid, net.stops, point, FAR_KM);
  const close = all.filter((s) => s.km <= NEAR_KM);
  return close.length >= FEWEST ? close : all.slice(0, Math.max(close.length, FEWEST));
}

/** Whether both ends of a journey are somewhere the timetable reaches. */
export function covers(net, from, to) {
  return stationsNear(net, from).length > 0 && stationsNear(net, to).length > 0;
}

/* ---------------------------------------------------------------- scan -- */

const NEVER = 0x7fffffff;
const NOT_BOARDED = -1;
// A train boarded by staying on the one before it, stored as -2 - that train.
const throughFrom = (t) => -2 - t;

/**
 * The earliest arrival at `to` leaving `from` at `minute` (minutes after the
 * start of the service day; after midnight is 1440 and on).
 *
 * Returns the journey as legs — walks and rides — or null if no train gets
 * there that day.
 *
 * The other ways there, for comparing (lib/trainOptions):
 *
 *   avoid   lines (indexes into net.lines) never to board
 *   only    lines to board, and no others
 *   change  minutes added to every boarding after the first, so a journey
 *           with fewer changes wins unless it is that much slower
 */
export function earliestJourney(net, from, to, minute, { avoid = null, only = null, change = 0 } = {}) {
  const starts = stationsNear(net, from);
  const ends = stationsNear(net, to);
  if (!starts.length || !ends.length) return null;

  const { stops, legs, walks } = net;
  const allowed = (line) => !(avoid && avoid.has(line)) && !(only && !only.has(line));
  const at = new Int32Array(stops.length).fill(NEVER); // earliest arrival at each stop
  const ready = new Int32Array(stops.length).fill(NEVER); // earliest you could board there
  const how = new Int32Array(stops.length).fill(NEVER); // leg arrived by, -2 - stop walked from, or -1 from the start
  const boarded = new Int32Array(net.trains.length).fill(NOT_BOARDED);
  const out = new Int32Array(stops.length).fill(-1); // minutes from each stop to the destination
  ends.forEach(({ index, km }) => { out[index] = walkFor(km) + OUT; });

  let best = NEVER;
  let bestStop = -1;
  const arrive = (stop, time) => {
    if (out[stop] >= 0 && time + out[stop] < best) { best = time + out[stop]; bestStop = stop; }
  };

  starts.forEach(({ index, km }) => {
    const t = minute + walkFor(km) + IN;
    if (t < at[index]) { at[index] = t; ready[index] = t; how[index] = -1; }
  });

  // The first leg leaving at or after the minute, by halving.
  let lo = 0;
  let hi = legs.count;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (legs.dep[mid] < minute) lo = mid + 1; else hi = mid; }

  for (let c = lo; c < legs.count; c += 1) {
    if (legs.dep[c] >= best) break;
    const t = legs.trip[c];
    if (boarded[t] === NOT_BOARDED && ready[legs.from[c]] <= legs.dep[c]
      && allowed(stops[legs.from[c]].line)) boarded[t] = c;
    if (boarded[t] === NOT_BOARDED) continue;

    const stop = legs.to[c];
    const time = legs.arr[c];
    if (time < at[stop]) {
      at[stop] = time;
      ready[stop] = time + SAME_PLATFORM + change;
      how[stop] = c;
      arrive(stop, time);
      for (let w = walks.start[stop]; w < walks.start[stop + 1]; w += 1) {
        const there = walks.to[w];
        const when = time + walks.minutes[w];
        if (when < at[there]) {
          at[there] = when; ready[there] = when + change; how[there] = -2 - stop;
          arrive(there, when);
        }
      }
    }
    if (legs.last[c]) {
      (net.nextOf.get(t) || []).forEach((next) => {
        if (boarded[next] === NOT_BOARDED && allowed(stops[legs.from[firstLeg(net, next)]].line)) {
          boarded[next] = throughFrom(t);
        }
      });
    }
  }

  if (bestStop < 0) return null;
  return journeyTo(net, { from, to, minute, best, bestStop, at, how, boarded });
}

/*
 * Back from the destination to the start: each stop says how it was reached,
 * each ride where it was boarded, and a ride boarded by staying on the train
 * before it hands back to that one.
 */
function journeyTo(net, { from, to, minute, best, bestStop, at, how, boarded }) {
  const { stops, legs } = net;
  const out = [{ kind: 'walk', to: 'end', from: bestStop, minutes: best - at[bestStop] }];
  let stop = bestStop;
  for (let guard = 0; guard < 64; guard += 1) {
    const h = how[stop];
    if (h === -1) {
      out.push({ kind: 'walk', from: 'start', to: stop, minutes: at[stop] - minute });
      break;
    }
    if (h <= -2) {
      const was = -2 - h;
      out.push({ kind: 'walk', from: was, to: stop, minutes: at[stop] - at[was] });
      stop = was;
      continue;
    }
    // A ride, perhaps over several trains running through.
    let leg = h;
    let train = legs.trip[leg];
    const rides = [];
    for (;;) {
      const on = boarded[train];
      if (on >= 0) {
        rides.unshift(ride(net, train, on, leg));
        stop = legs.from[on];
        break;
      }
      const before = -2 - on;
      rides.unshift(ride(net, train, firstLeg(net, train), leg));
      leg = lastLeg(net, before);
      train = before;
    }
    rides.forEach((r, i) => { r.through = i > 0; });
    out.push(...rides.reverse());
  }
  out.reverse();
  return {
    from, to, leaves: minute, arrives: best, legs: out,
  };
}

const legsOf = (net, train) => net.own.legs.subarray(net.own.start[train], net.own.start[train + 1]);
const firstLeg = (net, train) => net.own.legs[net.own.start[train]];
const lastLeg = (net, train) => net.own.legs[net.own.start[train + 1] - 1];

function ride(net, train, first, final) {
  const { legs } = net;
  // By position in the train, not by time: a loop line passes some stations twice.
  const all = legsOf(net, train);
  const a = all.indexOf(first);
  const b = all.indexOf(final);
  const at = a >= 0 && b >= a ? [...all.subarray(a, b + 1)] : [first];
  const t = net.trains[train];
  const lineIndex = net.stops[legs.from[first]].line;
  const line = net.lines[lineIndex];
  const taken = at.map((c) => legs.arr[c]);
  return {
    kind: 'ride',
    train,
    lineIndex,
    line: line[0],
    colour: line[1],
    vehicle: line[2],
    type: net.types[t.type] || '',
    from: legs.from[first],
    to: legs.to[final],
    leaves: legs.dep[first],
    arrives: legs.arr[final],
    stops: [legs.from[at[0]], ...at.map((c) => legs.to[c])],
    // When the train is at each of those stops: leaving the first, reaching the rest.
    times: [legs.dep[at[0]], ...taken],
    // Where the train is going, as its destination board says.
    toward: net.stops[legs.to[lastLeg(net, train)]].name,
  };
}

/* ------------------------------------------------------------- answers -- */

export const clock = (minute) => {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * A journey as /api/routes answers for Google: the time it takes, the line to
 * draw, and the named services — with when each leaves, which Google's answer
 * does not carry and a timetable does.
 */
export function asRoute(net, journey) {
  const points = [journey.from];
  const lines = [];
  journey.legs.forEach((leg) => {
    if (leg.kind === 'ride') {
      leg.stops.forEach((s) => { const p = net.stops[s]; if (p.lat != null) points.push({ lat: p.lat, lng: p.lng }); });
      lines.push({
        name: leg.line,
        vehicle: leg.vehicle,
        colour: leg.colour ? `#${leg.colour}` : '',
        from: net.stops[leg.from].name,
        to: net.stops[leg.to].name,
        departs: clock(leg.leaves),
        type: leg.type,
        through: leg.through,
      });
    }
  });
  points.push(journey.to);
  let km = 0;
  for (let i = 1; i < points.length; i += 1) km += haversineKm(points[i - 1], points[i]);
  return {
    mode: 'TRANSIT',
    found: true,
    source: 'timetable',
    seconds: (journey.arrives - journey.leaves) * 60,
    metres: Math.round(km * 1000),
    polyline: encodePath(points),
    lines: lines.slice(0, 6),
    leaves: clock(journey.leaves),
    arrives: clock(journey.arrives),
  };
}

/*
 * A typical journey, for a plan rather than for leaving now: the same trip
 * started every ten minutes through a weekday late morning, and the one that
 * takes the median time — waiting for the train included, as it is when you
 * actually go. Planning a day weeks ahead, the useful number is how long it
 * usually takes, not how long it takes if you happen to leave at 10:00.
 */
export const TYPICAL = [600, 610, 620, 630, 640, 650];

export function typicalJourney(net, from, to, starts = TYPICAL, choices = {}) {
  const found = starts.map((m) => earliestJourney(net, from, to, m, choices)).filter(Boolean);
  if (!found.length) return null;
  found.sort((a, b) => (a.arrives - a.leaves) - (b.arrives - b.leaves));
  return found[Math.floor((found.length - 1) / 2)];
}

/**
 * Tokyo's day and minute at an instant, as the timetable counts them: a
 * service day runs to three in the morning, so 01:30 on a Saturday is 25:30 on
 * Friday's weekday timetable. Public holidays run the weekend timetable and
 * are not known here, so a holiday Monday is treated as a weekday.
 */
export function tokyoClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let weekday = days.indexOf(parts.weekday);
  let minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (minute < 180) { weekday = (weekday + 6) % 7; minute += 1440; }
  return { day: weekday === 0 || weekday === 6 ? 'weekend' : 'weekday', minute };
}
