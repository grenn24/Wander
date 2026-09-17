/*
 * The globe's markers, in the map's one pin (components/mapPin): a circle
 * with a white ring.
 *
 * A place you have been, are going to or have favourited, and a journey, is a
 * circle holding its photograph, with its kind on a badge at the shoulder in
 * the colours the panel's counts use: a tick for completed, a clock for
 * upcoming, a heart for a favourite. A journey idea is smaller and has no
 * badge. A place just searched for is a dark circle with a plus.
 *
 * A stop on a chosen trip's route is the journal's numbered pin, in its day's
 * colour.
 *
 * The 3D globe draws only what lies inside a marker's own box, so each pin is
 * given room around it for its badge, its halo and the way it grows under a
 * pointer.
 */
import { createPin } from './mapPin';

const KIND = { been: '#b85a3c', planned: '#b8862f', favourite: '#c4506a', idea: '#5f5a55', preview: '#2b2724' };
const GLYPH = { been: 'tick', planned: 'clock', favourite: 'heart' };

/** Where a place's photograph comes from, small: a journey's cover, or a Google place photo. */
export function thumbOf(point) {
  if (point.thumb) return point.thumb;
  if (point.photo_ref) return `/api/places/photo?ref=${encodeURIComponent(point.photo_ref)}&w=160`;
  return null;
}

function roomFor(face, size) {
  const room = document.createElement('div');
  room.style.cssText = `padding:${Math.round(size * 0.45)}px;`;
  room.append(face.el);
  return room;
}

/**
 * A place's marker. `lift` for Google's flat map, which stands markers above
 * their point. Returns the element, `select`, and `wake` to load its photograph.
 */
export function createMarker(point, { lift = false } = {}) {
  const kind = KIND[point.kind] ? point.kind : 'been';
  const size = kind === 'idea' ? 30 : 40;
  const badgeKind = point.favourite ? 'favourite' : kind;
  const face = createPin({
    size,
    colour: KIND[kind],
    label: kind === 'preview' ? '+' : '',
    photo: kind === 'preview' ? null : thumbOf(point),
    badge: GLYPH[badgeKind] ? { colour: KIND[badgeKind], glyph: GLYPH[badgeKind] } : null,
    name: point.name,
    lift,
  });
  return {
    el: lift ? face.el : roomFor(face, size),
    wake: face.wake,
    select: (on) => face.set({ active: on }),
  };
}

/** A stop on the chosen route: its number, in its day's colour. */
export function createStop(stop, colour, { lift = false, onHover = null } = {}) {
  const face = createPin({ label: stop.n, colour, size: 26, name: `${stop.n}. ${stop.name}`, lift, onHover });
  return { el: lift ? face.el : roomFor(face, 26), set: face.set };
}
