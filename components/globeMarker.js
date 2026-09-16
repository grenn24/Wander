/*
 * The globe's markers: the place's photograph, pointing at the spot.
 *
 * A rounded photograph with a thin white edge — without one a photo of fields
 * disappears into the fields around it — and a small pointer beneath whose tip
 * is the place on the map. What kind of place it is sits in a badge on the
 * corner, in the colours the panel's counts use:
 *   been     a tick
 *   planned  a clock
 *   want     a star
 *   idea     no badge, and smaller: a journey someone could take
 *   preview  a place just searched for, not saved yet: a plus, and no photo
 *
 * The 3D globe draws a marker's HTML as it is, but only what lies inside the
 * marker's own box, so the badge that hangs off the corner is given room
 * inside it. Plain DOM rather than React, since the map owns these elements,
 * and inline styles, since the map does not carry the page's stylesheets in.
 */

const WHITE = '#ffffff';
const INK = { been: '#b85a3c', planned: '#b8862f', want: '#6e7a52', idea: '#5f5a55', preview: '#2b2724' };

const svg = (body, size = 11) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const BADGE = {
  been: svg(`<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="${WHITE}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`),
  planned: svg(`<circle cx="12" cy="12" r="8" fill="none" stroke="${WHITE}" stroke-width="2.6"/><path d="M12 7.5V12l3 2" fill="none" stroke="${WHITE}" stroke-width="2.6" stroke-linecap="round"/>`),
  want: svg(`<path fill="${WHITE}" d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.4 6.7L12 17.4 5.9 20.8l1.4-6.7-5-4.6 6.8-.8z"/>`),
};
const PLUS = svg(`<path d="M12 5v14M5 12h14" stroke="${WHITE}" stroke-width="2.8" stroke-linecap="round"/>`, 18);
// No photograph to show: a quiet landscape, so the tile still reads as a picture of somewhere.
const LANDSCAPE = svg(`<path d="M3 19l6-8 4 5 3-3 5 6z" fill="${WHITE}" opacity=".9"/><circle cx="16.5" cy="7.5" r="2.2" fill="${WHITE}" opacity=".9"/>`, 22);

const css = (el, styles) => { el.style.cssText = styles; return el; };
const div = (styles) => css(document.createElement('div'), styles);

/** Where a place's photograph comes from, small: a journey's cover, or a Google place photo. */
export function thumbOf(point) {
  if (point.thumb) return point.thumb;
  if (point.photo_ref) return `/api/places/photo?ref=${encodeURIComponent(point.photo_ref)}&w=160`;
  return null;
}

/**
 * A marker for one place. Returns the element and two controls: `select`
 * enlarges it, and `wake` starts its photograph loading — left until the
 * marker is first on the globe, so a town standing in for nothing until
 * someone flies in costs nothing until then.
 */
export function createMarker(point) {
  const kind = INK[point.kind] ? point.kind : 'been';
  const small = kind === 'idea';
  const size = small ? 34 : 48;
  const radius = small ? 9 : 12;
  const ink = INK[kind];

  // Room above and to the right for the badge; none below, where the pointer's
  // tip is the point on the map.
  const root = div('display:flex;flex-direction:column;align-items:center;'
    + `padding:${small ? '2px 2px 0' : '8px 8px 0'};transform-origin:50% 100%;cursor:pointer;`
    + 'filter:drop-shadow(0 4px 8px rgba(0,0,0,.45))');
  const tile = div(`position:relative;width:${size}px;height:${size}px;box-sizing:border-box;`
    + `border:${small ? 2 : 2.5}px solid ${WHITE};border-radius:${radius}px;background:${ink};overflow:hidden;`
    + 'display:grid;place-items:center');

  let wake = () => {};
  const src = kind === 'preview' ? null : thumbOf(point);
  if (kind === 'preview') {
    tile.style.background = 'rgba(30,27,24,.72)';
    tile.innerHTML = PLUS;
  } else if (src) {
    const img = css(document.createElement('img'), 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover');
    img.alt = '';
    img.decoding = 'async';
    // A photograph that will not load leaves the plain tile behind, not a broken image.
    img.onerror = () => { img.remove(); tile.innerHTML = LANDSCAPE; };
    wake = () => { if (!img.src) img.src = src; wake = () => {}; };
    tile.append(img);
  } else {
    tile.innerHTML = LANDSCAPE;
  }

  const holder = div('position:relative');
  holder.append(tile);
  if (BADGE[kind]) {
    const badge = div(`position:absolute;right:-7px;top:-7px;width:19px;height:19px;border-radius:50%;background:${ink};`
      + `box-shadow:0 0 0 2px ${WHITE};display:grid;place-items:center`);
    badge.innerHTML = BADGE[kind];
    holder.append(badge);
  }
  // The pointer: a small white triangle under the photograph, its tip on the spot.
  const pointer = div(`width:0;height:0;border-left:${small ? 5 : 7}px solid transparent;`
    + `border-right:${small ? 5 : 7}px solid transparent;border-top:${small ? 6 : 8}px solid ${WHITE};margin-top:-1px`);
  root.append(holder, pointer);

  let selected = null;
  return {
    el: root,
    wake: () => wake(),
    select(on) {
      if (on === selected) return;
      selected = on;
      // A chosen idea grows to the size of your own places, so it leads them.
      root.style.transform = on ? `scale(${small ? 1.45 : 1.25})` : '';
    },
  };
}
