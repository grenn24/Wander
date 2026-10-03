/*
 * Train journeys anywhere in Japan, estimated where there is no timetable.
 *
 * Outside greater Tokyo no operator publishes its timetable openly (see
 * lib/timetable for Tokyo, which has them). What is published is the network
 * itself — every line, station and piece of track — and how many trains run
 * on each section on a weekday (scripts/transit/build-japan.mjs). That is
 * enough for an honest estimate: the real route over the real lines, with
 * the time on board worked out from distance and the kind of line, and the
 * wait from how often trains come. It is shown as an estimate, never as a
 * timetable.
 *
 * The search is Dijkstra's over a graph of
 *
 *   interchanges  one per station name and place, each twice: before the
 *                 first train (walked to from the start) and after one
 *   platforms     one per line, station and direction, each twice: where a
 *                 train is boarded and where it arrives
 *   Shinkansen    a link between every two stations of a line, timed from
 *                 scripts/transit/shinkansen.mjs
 *
 * so a journey has to take at least one train, and changing is paid for
 * once, at the platform. Nothing here knows about files, Next or the DOM.
 */

import { haversineKm, walkFor } from './timetable.js';
import { encodePath, decodePath } from './polyline.js';

export const MODEL_FORMAT = 1;

/*
 * How fast each kind of line goes: a cruising speed between stations, and
 * minutes lost at each stop to braking, standing and pulling away. Fitted
 * against real timetables (scripts/transit/calibrate.mjs): greater Tokyo's
 * for journeys door to door, and the open feeds elsewhere — five regional
 * railways, four tram networks, Fukuoka's subway — for time on board. Tokyo
 * alone fits a slow train with short stops as well as a fast one with long
 * stops; the regional railways choose between them. What is left is a bias
 * on fast JR corridors, where a special rapid skips most stops: about a
 * fifth too slow.
 */
export const PACE = {
  rail: { kmh: 90, stop: 2.2 },
  subway: { kmh: 50, stop: 0.8 },
  monorail: { kmh: 50, stop: 0.8 },
  tram: { kmh: 25, stop: 0.6 },
  // How much a station most trains run through costs: (share that stop) ^ this.
  skip: 8,
};

/*
 * Waiting. The counts are trains a weekday, spread over about eighteen
 * hours, and you wait half the gap between two — but no more than half an
 * hour, because on a line with a train every two hours people plan around
 * it rather than turning up at random.
 */
const SERVICE_MINUTES = 18 * 60;
const MOST_WAIT = 30;
export const waitFor = (trainsPerDay) => Math.min(MOST_WAIT, SERVICE_MINUTES / Math.max(1, trainsPerDay) / 2);

// Changing lines within one station, and the extra minute when a train runs on into the next company's line.
const CHANGE = 4;
const THROUGH = 1;
// Getting to a platform from the street, and back out.
const IN = 2;
const OUT = 1;
// Two stations of different names, this close, are a walk apart.
const WALK_KM = 0.4;
const STREET = 4;

// A Shinkansen journey goes at the pace of the fastest train that stops at both ends.
const TIER_PACE = [1, 1, 1.12, 1.4];

const NEAR_KM = 1.0;
const FAR_KM = 3.0;
const FEWEST = 3;

/*
 * Minutes from one station to the next: the distance at the line's speed,
 * and the stop at the far end, in proportion to how many trains make it —
 * on a line with expresses, a station most trains run through costs little,
 * because the train people take is likely one of those.
 */
const runFor = (pace) => (kind, metres, stopping) => {
  const p = pace[kind] || pace.rail;
  return p.stop * Math.min(1, stopping) ** pace.skip + (metres / 1000 / p.kmh) * 60;
};
// What the rides into station i left out of its stop, for whoever gets off there.
const alightFor = (pace) => (l, i, forwards) => {
  const p = pace[l.k] || pace.rail;
  return p.stop * (1 - Math.min(1, share(l, i, forwards)) ** pace.skip);
};
// The share of the trains running past station i, each way, that stop there.
const share = (l, i, forwards) => {
  const passing = forwards ? Math.max(l.f[i - 1] || 0, l.f[i] || 0) : Math.max(l.r[i - 1] || 0, l.r[i] || 0);
  const stopping = forwards ? l.sf && l.sf[i] : l.sr && l.sr[i];
  return passing > 0 && stopping != null ? stopping / passing : 1;
};
// Trains a day that stop at station i going each way, for the wait: where the record has them, else every train past.
const stopsAt = (l, i, forwards) => {
  const all = forwards ? l.f[i] : l.r[i - 1];
  const here = forwards ? l.sf && l.sf[i] : l.sr && l.sr[i];
  return here > 0 ? Math.min(here, all) : all;
};

const VEHICLE = { rail: 'RAIL', subway: 'SUBWAY', monorail: 'MONORAIL', tram: 'TRAM', shinkansen: 'HIGH_SPEED_TRAIN' };

// Edge kinds, for reading a journey back.
const RIDE = 1;
const STAY = 2;
const BOARD = 3;
const ALIGHT = 4;
const WALK = 5;
const EXPRESS = 6;
const RUN_ON = 7;

/**
 * The network, ready to search. Built once per server.
 *
 *   pace  the speeds to use, for fitting them (scripts/transit/calibrate.mjs)
 */
export function buildModel(data, { pace = PACE } = {}) {
  if (!data || data.format !== MODEL_FORMAT) throw new Error('Unknown railway model format.');
  const run = runFor(pace);
  const hubs = data.hubs.map(([ja, en, lat, lng]) => ({ ja, en, lat, lng }));
  const lines = data.lines;

  // Node numbers: platforms first, line by line, then the interchanges.
  const base = [];
  let count = 0;
  lines.forEach((l) => {
    base.push(count);
    if (l.k !== 'shinkansen') count += l.s.length * 4;
  });
  const hubBase = count;
  count += hubs.length * 2;
  const platform = (li, i, dir, arrives) => base[li] + (i * 2 + dir) * 2 + (arrives ? 1 : 0);
  const fresh = (h) => hubBase + h * 2;
  const ridden = (h) => hubBase + h * 2 + 1;

  const edges = [];
  const add = (from, to, cost, kind, a = 0, b = 0) => edges.push([from, to, cost, kind, a, b]);

  lines.forEach((l, li) => {
    if (l.k === 'shinkansen') {
      for (let a = 0; a < l.s.length; a += 1) {
        for (let b = 0; b < l.s.length; b += 1) {
          if (a === b) continue;
          const tier = Math.max(l.tier[a], l.tier[b]);
          const ride = Math.abs(l.t[b] - l.t[a]) * TIER_PACE[tier];
          const wait = Math.min(MOST_WAIT, 60 / Math.max(0.25, Math.min(l.ph[a], l.ph[b])) / 2);
          add(fresh(l.s[a]), ridden(l.s[b]), wait + ride, EXPRESS, li, a * 1000 + b);
          add(ridden(l.s[a]), ridden(l.s[b]), wait + ride + CHANGE, EXPRESS, li, a * 1000 + b);
        }
      }
      return;
    }
    const n = l.s.length;
    for (let i = 0; i < n; i += 1) {
      const hub = l.s[i];
      // Forwards, along the station order: the hop from i to i + 1. Refs are line, and i * 2 + direction.
      if (i < n - 1 && l.f[i] > 0) {
        add(platform(li, i, 0, false), platform(li, i + 1, 0, true), run(l.k, l.m[i], share(l, i + 1, true)), RIDE, li, i * 2);
        add(fresh(hub), platform(li, i, 0, false), waitFor(stopsAt(l, i, true)), BOARD, li, i * 2);
        add(ridden(hub), platform(li, i, 0, false), waitFor(stopsAt(l, i, true)) + CHANGE, BOARD, li, i * 2);
        if (i > 0) add(platform(li, i, 0, true), platform(li, i, 0, false), 0, STAY, li, i * 2);
      }
      // Backwards: the hop from i to i - 1.
      if (i > 0 && l.r[i - 1] > 0) {
        add(platform(li, i, 1, false), platform(li, i - 1, 1, true), run(l.k, l.m[i - 1], share(l, i - 1, false)), RIDE, li, i * 2 + 1);
        add(fresh(hub), platform(li, i, 1, false), waitFor(stopsAt(l, i, false)), BOARD, li, i * 2 + 1);
        add(ridden(hub), platform(li, i, 1, false), waitFor(stopsAt(l, i, false)) + CHANGE, BOARD, li, i * 2 + 1);
        if (i < n - 1) add(platform(li, i, 1, true), platform(li, i, 1, false), 0, STAY, li, i * 2 + 1);
      }
      // Getting off, the train stops here whatever most trains do: the rest of the stop the ride left out.
      add(platform(li, i, 0, true), ridden(hub), alightFor(pace)(l, i, true), ALIGHT, li, i);
      add(platform(li, i, 1, true), ridden(hub), alightFor(pace)(l, i, false), ALIGHT, li, i);
    }
    // Round a loop line without getting off.
    if (l.loop) {
      add(platform(li, n - 1, 0, true), platform(li, 0, 0, false), 0, STAY, li, 0);
      add(platform(li, 0, 1, true), platform(li, n - 1, 1, false), 0, STAY, li, (n - 1) * 2 + 1);
    }
  });

  /*
   * Where one of a company's lines ends at the station the next begins, its
   * trains mostly run on: the JR Kobe Line becomes the San'yō Line at Kōbe.
   */
  const starts = new Map();
  lines.forEach((l, li) => {
    if (l.k === 'shinkansen' || l.loop) return;
    const key = `${l.o}|${l.s[0]}`;
    if (!starts.has(key)) starts.set(key, []);
    starts.get(key).push(li);
  });
  lines.forEach((l, li) => {
    if (l.k === 'shinkansen' || l.loop) return;
    const n = l.s.length;
    (starts.get(`${l.o}|${l.s[n - 1]}`) || []).forEach((next) => {
      if (next === li) return;
      add(platform(li, n - 1, 0, true), platform(next, 0, 0, false), THROUGH, RUN_ON, li, next);
      add(platform(next, 0, 1, true), platform(li, n - 1, 1, false), THROUGH, RUN_ON, next, li);
    });
  });

  /*
   * A company's short branch to an airport or the like mostly takes trains
   * through from its main line: the rapid from Sapporo onto the New Chitose
   * Airport branch at Minami-Chitose, the Haruka onto the Kansai Airport Line.
   * Changing onto one costs half the usual wait, and no walk.
   */
  const SHORT = 4;
  const onLine = new Map(); // `${company}|${station}` -> [[line, index]]
  lines.forEach((l, li) => {
    if (l.k === 'shinkansen' || l.s.length <= SHORT) return;
    l.s.forEach((h, i) => {
      const key = `${l.o}|${h}`;
      if (!onLine.has(key)) onLine.set(key, []);
      onLine.get(key).push([li, i]);
    });
  });
  lines.forEach((b, bi) => {
    if (b.k === 'shinkansen' || b.loop || b.s.length > SHORT) return;
    const n = b.s.length;
    [[0, b.f[0], 0], [n - 1, b.r[n - 2], 1]].forEach(([end, trains, dir]) => {
      if (!trains) return;
      (onLine.get(`${b.o}|${b.s[end]}`) || []).forEach(([li, i]) => {
        if (li === bi) return;
        const main = lines[li];
        // From the main line, either way, onto the branch; and off the branch onto the main line.
        add(platform(li, i, 0, true), platform(bi, end, dir, false), THROUGH + waitFor(trains) / 2, RUN_ON, li, bi);
        add(platform(li, i, 1, true), platform(bi, end, dir, false), THROUGH + waitFor(trains) / 2, RUN_ON, li, bi);
        const back = 1 - dir;
        if (i < main.s.length - 1 && main.f[i]) add(platform(bi, end, back, true), platform(li, i, 0, false), THROUGH + waitFor(main.f[i]) / 2, RUN_ON, bi, li);
        if (i > 0 && main.r[i - 1]) add(platform(bi, end, back, true), platform(li, i, 1, false), THROUGH + waitFor(main.r[i - 1]) / 2, RUN_ON, bi, li);
      });
    });
  });

  // Walks between interchanges of different names, before the first train and between trains.
  const grid = gridOf(hubs);
  hubs.forEach((a, i) => {
    nearby(grid, hubs, a, WALK_KM).forEach(({ index: j, km }) => {
      if (i === j) return;
      const minutes = walkFor(km) + STREET;
      add(fresh(i), fresh(j), minutes, WALK, i, j);
      add(ridden(i), ridden(j), minutes, WALK, i, j);
    });
  });

  // Flat arrays, by source node.
  const start = new Int32Array(count + 1);
  edges.forEach((e) => { start[e[0] + 1] += 1; });
  for (let i = 0; i < count; i += 1) start[i + 1] += start[i];
  const fill = start.slice(0, count);
  const to = new Int32Array(edges.length);
  const cost = new Float32Array(edges.length);
  const kind = new Uint8Array(edges.length);
  const ra = new Int32Array(edges.length);
  const rb = new Int32Array(edges.length);
  edges.forEach(([f, t, c, k, a, b]) => {
    const at = fill[f]++;
    to[at] = t; cost[at] = c; kind[at] = k; ra[at] = a; rb[at] = b;
  });

  return {
    hubs, lines, operators: data.operators, count, hubBase, grid, fresh, ridden,
    edges: { start, to, cost, kind, a: ra, b: rb },
  };
}

/* --------------------------------------------------------------- places -- */

const CELL = 0.01;
function gridOf(points) {
  const grid = new Map();
  points.forEach((p, i) => {
    const key = `${Math.floor(p.lat / CELL)},${Math.floor(p.lng / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  return grid;
}

function nearby(grid, points, at, km) {
  const reach = Math.ceil(km / (CELL * 111 * Math.cos(at.lat * Math.PI / 180))) + 1;
  const row = Math.floor(at.lat / CELL);
  const col = Math.floor(at.lng / CELL);
  const out = [];
  for (let r = row - reach; r <= row + reach; r += 1) {
    for (let c = col - reach; c <= col + reach; c += 1) {
      (grid.get(`${r},${c}`) || []).forEach((index) => {
        const d = haversineKm(at, points[index]);
        if (d <= km) out.push({ index, km: d });
      });
    }
  }
  return out.sort((a, b) => a.km - b.km);
}

/** Stations worth walking to from a point, as for the timetable: within a kilometre, or the nearest few within three. */
export function stationsNear(model, point) {
  const all = nearby(model.grid, model.hubs, point, FAR_KM);
  const close = all.filter((s) => s.km <= NEAR_KM);
  return close.length >= FEWEST ? close : all.slice(0, Math.max(close.length, FEWEST));
}

/* --------------------------------------------------------------- search -- */

/**
 * The quickest journey by train between two points, as the model reckons it,
 * or null where either end is beyond walking distance of a station.
 *
 * The other ways there, for comparing (lib/trainOptions):
 *
 *   avoid   lines (indexes into model.lines) never to board or run on to
 *   only    lines to board and run on to, and no others
 *   change  minutes added to every boarding after the first, so a journey
 *           with fewer changes wins unless it is that much slower; it steers
 *           the search and is not counted in the journey's minutes
 */
export function modelJourney(model, from, to, { avoid = null, only = null, change = 0 } = {}) {
  const starts = stationsNear(model, from);
  const ends = stationsNear(model, to);
  if (!starts.length || !ends.length) return null;

  const { count, edges } = model;
  const dist = new Float64Array(count).fill(Infinity);
  const via = new Int32Array(count).fill(-1);
  const exit = new Map(ends.map(({ index, km }) => [model.ridden(index), walkFor(km) + OUT]));
  const heap = new Heap();

  starts.forEach(({ index, km }) => {
    const node = model.fresh(index);
    const d = walkFor(km) + IN;
    if (d < dist[node]) { dist[node] = d; heap.push(node, d); }
  });

  let best = Infinity;
  let bestNode = -1;
  while (heap.size) {
    const [node, d] = heap.pop();
    if (d > dist[node]) continue;
    if (d >= best) break;
    if (exit.has(node) && d + exit.get(node) < best) { best = d + exit.get(node); bestNode = node; }
    const afterRide = node >= model.hubBase && (node - model.hubBase) % 2 === 1;
    for (let e = edges.start[node]; e < edges.start[node + 1]; e += 1) {
      const k = edges.kind[e];
      const boards = k === BOARD || k === EXPRESS ? edges.a[e] : k === RUN_ON ? edges.b[e] : -1;
      if (boards >= 0 && ((avoid && avoid.has(boards)) || (only && !only.has(boards)))) continue;
      const next = edges.to[e];
      const nd = d + edges.cost[e] + (afterRide && (k === BOARD || k === EXPRESS) ? change : 0);
      if (nd < dist[next]) { dist[next] = nd; via[next] = e; heap.push(next, nd); }
    }
  }
  if (bestNode < 0) return null;

  // Back from the end, edge by edge.
  const path = [];
  for (let node = bestNode; via[node] >= 0;) {
    const e = via[node];
    path.push(e);
    node = sourceOf(edges, e);
  }
  path.reverse();
  // Take back what changing was made to cost: it steered the search, it is not time.
  let steering = 0;
  if (change) {
    path.forEach((e) => {
      const k = edges.kind[e];
      const source = sourceOf(edges, e);
      if ((k === BOARD || k === EXPRESS) && source >= model.hubBase && (source - model.hubBase) % 2 === 1) steering += change;
    });
  }
  return { from, to, minutes: best - steering, path };
}

// The node an edge leaves from: found by halving, since edges are stored by source.
function sourceOf(edges, e) {
  let lo = 0;
  let hi = edges.start.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges.start[mid] <= e) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/* ------------------------------------------------------------- answers -- */

const nameOf = (x) => x.en || x.ja;

/**
 * A journey read back as legs, in order, their minutes adding up to the
 * journey's:
 *
 *   { kind: 'walk', minutes, from, to }        from and to are hub indexes, or
 *                                              'start' and 'end'
 *   { kind: 'wait', minutes }                   for the train, as an average
 *   { kind: 'ride', minutes, lineIndex, from, to, stops: [hub], through,
 *     points: [{ lat, lng }] along the track, forwards: along the line's order }
 *
 * A change of line is a walk between platforms, a wait, and the next ride.
 */
export function modelLegs(model, journey) {
  const { edges, hubs, lines } = model;
  const out = [];
  const firstHub = journey.path.length ? hubOf(model, sourceOf(edges, journey.path[0])) : null;
  const access = firstHub == null ? 0 : walkFor(haversineKm(journey.from, hubs[firstHub])) + IN;
  out.push({ kind: 'walk', minutes: access, from: 'start', to: firstHub });
  let current = null;
  let spent = access;
  journey.path.forEach((e) => {
    const k = edges.kind[e];
    const a = edges.a[e];
    const b = edges.b[e];
    const cost = edges.cost[e];
    const source = sourceOf(edges, e);
    const afterRide = source >= model.hubBase && (source - model.hubBase) % 2 === 1;
    spent += cost;
    if (k === BOARD) {
      const at = lines[a].s[b >> 1];
      if (afterRide) {
        out.push({ kind: 'walk', minutes: CHANGE, from: at, to: at, change: true });
        out.push({ kind: 'wait', minutes: cost - CHANGE });
      } else {
        out.push({ kind: 'wait', minutes: cost });
      }
      current = { kind: 'ride', minutes: 0, lineIndex: a, from: at, to: at, stops: [at], through: false, points: [hubs[at]], forwards: (b & 1) === 0 };
      out.push(current);
    } else if (k === RIDE || k === STAY) {
      if (k === RIDE) {
        const l = lines[a];
        const i = b >> 1;
        const forwards = (b & 1) === 0;
        const there = forwards ? i + 1 : i - 1;
        const hop = forwards ? i : i - 1;
        const shape = l.g[hop] ? decodePath(l.g[hop]) : [hubs[l.s[i]], hubs[l.s[there]]];
        current.points.push(...(forwards ? shape : shape.reverse()));
        current.to = l.s[there];
        current.stops.push(current.to);
      }
      current.minutes += cost;
    } else if (k === RUN_ON) {
      current = {
        kind: 'ride', minutes: cost, lineIndex: b, from: current.to, to: current.to,
        stops: [current.to], through: true, points: [hubs[current.to]], forwards: true,
      };
      out.push(current);
    } else if (k === EXPRESS) {
      const l = lines[a];
      const from = Math.floor(b / 1000);
      const till = b % 1000;
      const wait = Math.min(MOST_WAIT, 60 / Math.max(0.25, Math.min(l.ph[from], l.ph[till])) / 2);
      if (afterRide) out.push({ kind: 'walk', minutes: CHANGE, from: l.s[from], to: l.s[from], change: true });
      out.push({ kind: 'wait', minutes: wait });
      const step = till > from ? 1 : -1;
      // The train taken is the fastest stopping at both ends; it calls where its tier does.
      const tier = Math.max(l.tier[from], l.tier[till]);
      const passed = [];
      const calls = [];
      for (let i = from; i !== till + step; i += step) {
        passed.push(l.s[i]);
        if (i === from || i === till || l.tier[i] <= tier) calls.push(l.s[i]);
      }
      out.push({
        kind: 'ride', minutes: cost - wait - (afterRide ? CHANGE : 0), lineIndex: a,
        from: l.s[from], to: l.s[till], stops: calls, through: false, express: [from, till],
        points: passed.map((h) => hubs[h]), forwards: step > 0,
      });
      current = null;
    } else if (k === ALIGHT) {
      if (current) current.minutes += cost;
    } else if (k === WALK) {
      out.push({ kind: 'walk', minutes: cost, from: a, to: b });
    }
  });
  const last = out[out.length - 1];
  const lastHub = last.kind === 'ride' ? last.to : last.to;
  out.push({ kind: 'walk', minutes: Math.max(0, journey.minutes - spent), from: lastHub, to: 'end' });
  return out;
}

// The interchange a node belongs to, or null for a platform.
function hubOf(model, node) {
  return node >= model.hubBase ? (node - model.hubBase) >> 1 : null;
}

/**
 * The name of a Shinkansen journey from station a to b: the line it is on,
 * Tōkaidō or San'yō, or both where it runs from one onto the other.
 * `parts` lists where each named line ends: [last station, ja, en].
 */
export function expressName(line, a, b) {
  if (!line.parts) return line;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let first = 0;
  for (const [last, ja, en] of line.parts) {
    if (lo >= first && hi <= last) return { ja, en };
    first = last;
  }
  return line;
}

/** A modelled journey as /api/routes answers: an estimate, but drawn along the real track. */
export function modelRoute(model, journey) {
  const { edges, hubs, lines } = model;
  const points = [journey.from];
  const rides = [];
  let km = 0;
  const push = (p) => {
    const last = points[points.length - 1];
    if (last.lat !== p.lat || last.lng !== p.lng) { km += haversineKm(last, p); points.push(p); }
  };

  let current = null;
  journey.path.forEach((e) => {
    const k = edges.kind[e];
    const a = edges.a[e];
    const b = edges.b[e];
    if (k === BOARD) {
      const l = lines[a];
      const at = l.s[b >> 1];
      push(hubs[at]);
      current = { line: a, from: at, to: at, through: false };
      rides.push(current);
    } else if (k === RIDE) {
      const l = lines[a];
      const i = b >> 1;
      const forwards = (b & 1) === 0;
      const hop = forwards ? i : i - 1;
      const there = forwards ? i + 1 : i - 1;
      const shape = l.g[hop] ? decodePath(l.g[hop]) : [hubs[l.s[i]], hubs[l.s[there]]];
      (forwards ? shape : shape.reverse()).forEach(push);
      current.to = l.s[there];
    } else if (k === RUN_ON) {
      current = { line: b, from: current.to, to: current.to, through: true };
      rides.push(current);
    } else if (k === EXPRESS) {
      const l = lines[a];
      const from = Math.floor(b / 1000);
      const till = b % 1000;
      const step = till > from ? 1 : -1;
      for (let i = from; i !== till + step; i += step) push(hubs[l.s[i]]);
      rides.push({ line: a, from: l.s[from], to: l.s[till], through: false, express: [from, till] });
      current = null;
    } else if (k === WALK) {
      push(hubs[b]);
    }
  });
  push(journey.to);

  return {
    mode: 'TRANSIT',
    found: true,
    source: 'model',
    seconds: Math.round(journey.minutes) * 60,
    metres: Math.round(km * 1000),
    polyline: encodePath(points),
    lines: rides.map((r) => {
      const l = lines[r.line];
      const named = r.express ? expressName(l, r.express[0], r.express[1]) : l;
      return {
        name: nameOf(named),
        ja: named.ja,
        vehicle: VEHICLE[l.k] || 'RAIL',
        colour: '',
        from: nameOf(hubs[r.from]),
        to: nameOf(hubs[r.to]),
        through: r.through,
      };
    }).slice(0, 6),
  };
}

/* ----------------------------------------------------------------- heap -- */

class Heap {
  constructor() { this.nodes = []; this.keys = []; }

  get size() { return this.nodes.length; }

  push(node, key) {
    const { nodes, keys } = this;
    let i = nodes.length;
    nodes.push(node); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      nodes[i] = nodes[p]; keys[i] = keys[p];
      i = p;
    }
    nodes[i] = node; keys[i] = key;
  }

  pop() {
    const { nodes, keys } = this;
    const top = [nodes[0], keys[0]];
    const node = nodes.pop();
    const key = keys.pop();
    if (nodes.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= nodes.length) break;
        const r = l + 1;
        const c = r < nodes.length && keys[r] < keys[l] ? r : l;
        if (keys[c] >= key) break;
        nodes[i] = nodes[c]; keys[i] = keys[c];
        i = c;
      }
      nodes[i] = node; keys[i] = key;
    }
    return top;
  }
}
