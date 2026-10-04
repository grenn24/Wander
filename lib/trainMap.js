/*
 * What the map draws for a hop's train options (lib/trainOptions): the
 * option being shown leg by leg — each train in its line's colour, each walk
 * dotted — the other options faint behind it, and the marks along the way:
 * a dot at each station got off at, the line's badge where it is boarded,
 * the exit, and how long each walk takes. Each piece carries its tooltip.
 * Plain data, so it is tested with node; components/GoogleMap draws it.
 */

import { decodePath } from './polyline.js';
import { thinPath } from './geo.js';
import { legTip, optionTip } from './trainView.js';

const pathOf = (leg) => (leg.polyline ? decodePath(leg.polyline) : []);

function middle(path) {
  if (path.length === 1) return path[0];
  const a = path[Math.floor((path.length - 1) / 2)];
  const b = path[Math.ceil((path.length - 1) / 2)];
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/**
 *   options  a hop's options
 *   shownId  the one to draw; the first where it is not among them
 *   to       where the hop ends, for the tooltips
 *   walk     the colour walks are drawn in (the day's)
 *
 * Returns { shownId, segments: [{ path, colour, kind, tip }], faint: [{ id, path, tip }],
 * marks: [{ at, kind: 'station'|'board'|'exit'|'walk', line?, label? }] }.
 */
export function trainDrawing(options, shownId, { to = '', walk = '#8d8377' } = {}) {
  if (!options || !options.length) return null;
  const shown = options.find((o) => o.id === shownId) || options[0];
  const segments = [];
  const marks = [];
  shown.legs.forEach((leg, i) => {
    const path = pathOf(leg);
    if (path.length < 2) return;
    if (leg.kind === 'ride') {
      const colour = leg.line.colour || (leg.line.operator && leg.line.operator.colour) || walk;
      segments.push({ path, colour, kind: 'ride', tip: legTip(shown, i, { to }) });
      if (!leg.through) marks.push({ at: path[0], kind: 'board', line: leg.line });
      marks.push({ at: path[path.length - 1], kind: 'station' });
    } else if (leg.kind === 'walk') {
      segments.push({ path, colour: walk, kind: 'walk', tip: legTip(shown, i, { to }) });
      // A walk out of an exit goes station, exit, destination: the exit marked, the minutes beyond it.
      const out = leg.exit && path.length > 2 ? 1 : 0;
      marks.push({ at: middle(path.slice(out)), kind: 'walk', label: `${leg.minutes} min` });
      if (leg.exit) marks.push({ at: path[out], kind: 'exit', label: leg.exit });
    }
  });
  const faint = options.filter((o) => o !== shown).map((o) => ({
    id: o.id,
    path: o.legs.flatMap(pathOf),
    tip: optionTip(o, { to, fare: o.fare }),
  })).filter((f) => f.path.length > 1);
  return { shownId: shown.id, segments, faint, marks };
}

const trainsOf = (leg) => (leg && leg.options.find((o) => o.mode === 'TRANSIT' && o.trains)) || null;

/**
 * The lines the trip map draws, one for each hop. While a hop's train
 * options are open, that hop alone, its option shown train by train, without
 * the others: nothing else on the map competes with it. Otherwise each hop
 * the way the Routes setting draws it; a train among them carries what it
 * rides (`tip`) and its hop (`open`), to say so when pointed at and to open
 * its options when clicked.
 *
 *   hops      [{ key, from, to, toTitle, day }]
 *   legs      the hops' ways, from components/useLegs: { byKey }
 *   open      the hop whose train options are open, or null
 *   shown     the option shown for each hop, by key
 *   colourOf  a hop's day colour
 *   trains    whether trains say what they are and open (the trip's hops, not picked stops)
 *
 * Returns [{ from, to, colour, path, estimate, tip?, open? }] or, for the open
 * hop, [{ from, to, colour, train }] (trainDrawing's, with no faint options).
 */
export function hopLines(hops, legs, { open = null, shown = {}, colourOf = () => '#8d8377', trains = false } = {}) {
  if (trains && open) {
    const h = hops.find((x) => x.key === open);
    const way = h && trainsOf(legs.byKey[h.key]);
    const colour = h && colourOf(h);
    const train = way && trainDrawing(way.trains, shown[h.key], { to: h.toTitle, walk: colour });
    if (train) return [{ from: h.from, to: h.to, colour, train: { ...train, faint: [] } }];
  }
  return hops.map((h) => {
    const leg = legs.byKey[h.key];
    const way = leg && leg.options.find((o) => o.mode === leg.drawn);
    // A modelled train time is an estimate, but its line follows the real track, so it is drawn.
    const real = !!(way && way.polyline && (!way.estimate || way.source === 'model'));
    const first = trains && real && way.mode === 'TRANSIT' && way.trains ? way.trains[0] : null;
    return {
      from: h.from, to: h.to, colour: colourOf(h),
      // Thinned: a drive across a city comes back with hundreds of points a
      // few metres apart, and every one of them is carried in every frame.
      path: real ? thinPath(decodePath(way.polyline), 15) : null, estimate: !real,
      ...(first ? { tip: optionTip(first, { to: h.toTitle, fare: first.fare }), open: h.key } : {}),
    };
  });
}

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Where a mark on screen can go clear of what is already there: [dx, dy] in
 * pixels, [0, 0] where it is clear already, the nearest way round otherwise
 * (above, below, beside, then further), or null where nothing near is clear.
 *
 *   rect   the mark's box { left, right, top, bottom }
 *   taken  the boxes it must not cover: the stops' pins, the marks placed before it
 */
export function clearSpot(rect, taken, gap = 4) {
  const up = rect.bottom - rect.top + gap;
  const side = (rect.right - rect.left) / 2 + gap + 10;
  const tries = [[0, 0], [0, -up], [0, up], [side, 0], [-side, 0], [side, -up], [-side, -up], [side, up], [-side, up],
    [0, -2 * up], [0, 2 * up], [2 * side, 0], [-2 * side, 0]];
  return tries.find(([dx, dy]) => {
    const moved = { left: rect.left + dx, right: rect.right + dx, top: rect.top + dy, bottom: rect.bottom + dy };
    return !taken.some((t) => overlaps(moved, t));
  }) || null;
}
