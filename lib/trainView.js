/*
 * What the train options panel and the map say about an option
 * (lib/trainOptions): the pieces of its journey bar, the line under each
 * card, its steps, and the three-line tooltip for any piece of it. Words
 * only; nothing here knows about React or the DOM, so it is tested with node.
 */

import { fmtMinute } from './util.js';

const rides = (option) => option.legs.filter((l) => l.kind === 'ride');

/** The lines an option rides, each once, in order. */
export function linesOf(option) {
  const seen = new Set();
  return rides(option).map((r) => r.line).filter((l) => (seen.has(l.id) ? false : seen.add(l.id)));
}

function changeWord(option) {
  if (!option.changes) return 'no change';
  if (option.changes === 1) {
    const first = rides(option).find((r, i, all) => all[i + 1] && !all[i + 1].through);
    return first ? `change at ${first.to}` : '1 change';
  }
  return `${option.changes} changes`;
}

/**
 * The line under an option's badges: how often (or, leaving now, when the
 * first train goes) and the changes. "Every 4 min · no change".
 */
export function summaryOf(option, mode = 'plan') {
  const first = rides(option)[0];
  const parts = [];
  if (first) {
    if (mode === 'now' && first.next != null) parts.push(`Next ${fmtMinute(first.next)}`);
    else if (first.every) parts.push(`Every ${first.every} min`);
  }
  parts.push(changeWord(option));
  const out = parts.join(' · ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** What a walk is for: to the first train, between two, or the last stretch. */
function walkRole(option, index) {
  const leg = option.legs[index];
  const before = option.legs.slice(0, index).some((l) => l.kind === 'ride');
  const after = option.legs.slice(index + 1).some((l) => l.kind === 'ride');
  if (!before) return 'first';
  if (!after) return 'last';
  return leg.change === false ? 'between' : 'change';
}

const nextRide = (option, index) => option.legs.slice(index + 1).find((l) => l.kind === 'ride');
const prevRide = (option, index) => option.legs.slice(0, index).reverse().find((l) => l.kind === 'ride');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The tooltip for one leg of an option: { lines, walk, exit, title, body,
 * meta, operator }, as components/TrainBits RichTip shows it.
 *
 *   to  the name of where the journey ends, for the last walk
 */
export function legTip(option, index, { to = '' } = {}) {
  const leg = option.legs[index];
  if (leg.kind === 'ride') {
    const meta = [];
    if (leg.line.operator) meta.push(leg.line.operator.name);
    meta.push(plural(leg.stops.length + 1, 'stop'));
    if (leg.every) meta.push(`every ${leg.every} min`);
    return {
      lines: [leg.line],
      title: leg.type && leg.type !== 'Local' ? `${leg.line.name} · ${leg.type}` : leg.line.name,
      body: `${leg.from} → ${leg.to} · ${leg.minutes} min`,
      meta: meta.join(' · '),
      operator: leg.line.operator,
    };
  }
  if (leg.kind === 'wait') {
    const next = nextRide(option, index);
    return {
      title: `Wait about ${leg.minutes} min`,
      body: next ? `For the next ${next.line.name} train` : 'For the next train',
      meta: next && next.every ? `Trains every ${next.every} min` : '',
    };
  }
  const role = walkRole(option, index);
  const next = nextRide(option, index);
  const prev = prevRide(option, index);
  let body = '';
  if (role === 'first') body = next ? `To ${next.from}` : '';
  else if (role === 'last') body = `${prev ? prev.to : leg.from || ''} → ${to}`.trim();
  else body = `Change at ${prev ? prev.to : leg.from} to the ${next ? next.line.name : 'next train'}`;
  return { walk: true, exit: leg.exit || null, title: `Walk ${leg.minutes} min`, body };
}

/** The tooltip for a whole option, for the faint routes on the map. */
export function optionTip(option, { to = '', fare = null } = {}) {
  const lines = linesOf(option);
  const body = [`${to ? `To ${to} · ` : ''}${Math.round(option.seconds / 60)} min`];
  if (fare) body.push(`¥${fare.toLocaleString('en-US')}`);
  return {
    lines,
    title: lines.map((l) => l.name.replace(/ Line$/, '')).join(' → '),
    body: body.join(' · '),
    meta: `${changeWord(option).replace(/^./, (c) => c.toUpperCase())} · click to show`,
  };
}

/**
 * The pieces of an option's journey bar, in order: walks, waits and rides,
 * each with its minutes, its kind and, for a ride, its line's colour.
 */
export function barOf(option, { to = '' } = {}) {
  return option.legs.map((leg, index) => ({
    kind: leg.kind,
    minutes: leg.minutes,
    colour: leg.kind === 'ride' ? (leg.line.colour || (leg.line.operator && leg.line.operator.colour) || '') : '',
    tip: legTip(option, index, { to }),
  })).filter((p) => p.minutes > 0);
}

/**
 * An opened option's steps, in order:
 *
 *   { kind: 'walk', text, exit, minutes }
 *   { kind: 'ride', index, leg }            index into option.legs
 *   { kind: 'end', text }
 *
 * Waits are left to the bar; a train's step says when it goes.
 */
export function stepsOf(option, { to = '' } = {}) {
  const out = [];
  option.legs.forEach((leg, index) => {
    if (leg.kind === 'ride') { out.push({ kind: 'ride', index, leg }); return; }
    if (leg.kind !== 'walk' || leg.minutes <= 0) return;
    const role = walkRole(option, index);
    const next = nextRide(option, index);
    const prev = prevRide(option, index);
    let text;
    if (role === 'first') text = next ? `Walk ${leg.minutes} min to ${next.from}` : `Walk ${leg.minutes} min`;
    else if (role === 'last') text = `Walk ${leg.minutes} min${to ? ` to ${to}` : ''}`;
    else text = `Change at ${prev ? prev.to : leg.from} · ${leg.minutes} min walk`;
    out.push({ kind: 'walk', text, exit: role === 'last' ? leg.exit || null : null, minutes: leg.minutes });
  });
  if (to) out.push({ kind: 'end', text: to });
  return out;
}

/** A ride's line under its station: "Rapid toward Takao", the type left out when it is a plain local. */
export function directionOf(leg) {
  const type = leg.type && leg.type !== 'Local' ? `${leg.type} ` : '';
  return leg.toward ? `${type}toward ${leg.toward}`.replace(/^t/, (c) => (type ? c : 'T')) : type.trim();
}
