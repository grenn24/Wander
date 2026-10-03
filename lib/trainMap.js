/*
 * What the map draws for a hop's train options (lib/trainOptions): the
 * option being shown leg by leg — each train in its line's colour, each walk
 * dotted — the other options faint behind it, and the marks along the way:
 * a dot at each station got off at, the line's badge where it is boarded,
 * the exit, and how long each walk takes. Each piece carries its tooltip.
 * Plain data, so it is tested with node; components/GoogleMap draws it.
 */

import { decodePath } from './polyline.js';
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
