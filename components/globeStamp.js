/*
 * The globe's markers: postage stamps.
 *
 * The journals already keep their photographs as a scrapbook, taped in with
 * stamps, and a stamp is the one travel object made to carry a picture of
 * somewhere. So each place on the globe is a small perforated stamp with its
 * photograph, standing on a short stem over the exact spot.
 *
 * What kind of place it is shows in how the stamp has been used:
 *   been     franked — a postmark inked across the corner
 *   planned  clean, with an amber engraved frame
 *   want     a sage frame and a star
 *   idea     a journey someone could take: half size, and quiet
 *   preview  a place just searched for: an empty slot in the album
 *
 * The 3D globe draws a marker's HTML as it is, but only what lies inside the
 * marker's own box, so anything hanging off the stamp is given room inside it.
 * Plain DOM rather than React, since the map owns these elements, and inline
 * styles, since the map does not carry the page's stylesheets into them.
 */

const PAPER = '#fcfaf4';
// Printing inks: the app's own colours at their darkest, which read as ink on paper.
const INK = { been: '#a34f35', planned: '#a8792d', want: '#687052', idea: '#5f5a55', preview: '#fcfaf4' };
const NS = 'http://www.w3.org/2000/svg';

const hash = (s) => {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
};

/** The slight angle a stamp was stuck down at: its own, the same every visit. */
export const tiltOf = (id) => ((hash(id) % 9) - 4) * 1.3;

/*
 * The stamp's outline, as a mask: a rectangle with half-circles bitten out of
 * every edge. The bites are spaced to fit each edge exactly, so the corners
 * match rather than ending on a sliver.
 */
const masks = new Map();
export function perforation(w, h, pitch, r) {
  const key = `${w}x${h}/${pitch}/${r}`;
  if (masks.has(key)) return masks.get(key);
  const nx = Math.max(1, Math.round(w / pitch));
  const ny = Math.max(1, Math.round(h / pitch));
  const holes = [];
  for (let i = 0; i < nx; i += 1) {
    const x = +((w / nx) * (i + 0.5)).toFixed(2);
    holes.push(`<circle cx="${x}" cy="0" r="${r}"/><circle cx="${x}" cy="${h}" r="${r}"/>`);
  }
  for (let i = 0; i < ny; i += 1) {
    const y = +((h / ny) * (i + 0.5)).toFixed(2);
    holes.push(`<circle cx="0" cy="${y}" r="${r}"/><circle cx="${w}" cy="${y}" r="${r}"/>`);
  }
  const svg = `<svg xmlns="${NS}" width="${w}" height="${h}"><defs><mask id="p">`
    + `<rect width="${w}" height="${h}" fill="white"/><g fill="black">${holes.join('')}</g></mask></defs>`
    + `<rect width="${w}" height="${h}" fill="black" mask="url(#p)"/></svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  masks.set(key, url);
  return url;
}

/*
 * A round date stamp over the corner with three wavy lines trailing off it,
 * and a tick in the ring. Drawn twice, paper under ink, so it reads over a
 * dark photograph as well as a light one.
 */
function postmark(ink) {
  const waves = [8, 13, 18].map((y) => `M2 ${y} q3.2 -2.6 6.4 0 t6.4 0 t6.4 0`).join(' ');
  const marks = `<circle cx="34" cy="13" r="9.5"/><path d="${waves}"/><path d="M30.2 13.4 l2.6 2.6 l5 -5.4"/>`;
  return `<svg xmlns="${NS}" width="46" height="26" viewBox="0 0 46 26" aria-hidden="true">`
    + '<g fill="none" stroke-linecap="round" stroke-linejoin="round">'
    + `<g stroke="${PAPER}" stroke-width="4.2" opacity=".85">${marks}</g>`
    + `<g stroke="${ink}" stroke-width="2">${marks}</g></g></svg>`;
}

const STAR = '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">'
  + `<path fill="${PAPER}" d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.4 6.7L12 17.4 5.9 20.8l1.4-6.7-5-4.6 6.8-.8z"/></svg>`;

const PLUS = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">'
  + `<path d="M8 3v10M3 8h10" stroke="${PAPER}" stroke-width="2.2" stroke-linecap="round"/></svg>`;

const css = (el, styles) => { el.style.cssText = styles; return el; };
const div = (styles) => css(document.createElement('div'), styles);

/** Where a place's photograph comes from, small: a journey's cover, or a Google place photo. */
export function thumbOf(point) {
  if (point.thumb) return point.thumb;
  if (point.photo_ref) return `/api/places/photo?ref=${encodeURIComponent(point.photo_ref)}&w=160`;
  return null;
}

/**
 * A stamp for one place. Returns the element and two controls: `select`
 * straightens and enlarges it, and `wake` starts its photograph loading —
 * left until the stamp is first on the globe, so a town hidden behind its
 * country's fill costs nothing until someone flies in to see it.
 */
export function createStamp(point) {
  const kind = INK[point.kind] ? point.kind : 'been';
  const mini = kind === 'idea';
  const ink = INK[kind];
  const w = mini ? 30 : 46;
  const h = mini ? 36 : 56;
  const tilt = tiltOf(point.id);

  // Room above and to the side for the postmark and star, none below: the dot
  // at the bottom is the point on the map.
  const root = div('display:flex;flex-direction:column;align-items:center;'
    + `padding:${mini ? '2px 2px 0' : '10px 12px 0'};`
    + 'filter:drop-shadow(0 3px 5px rgba(0,0,0,.55));transform-origin:50% 100%;cursor:pointer');
  const card = div(`position:relative;width:${w}px;height:${h}px;transform:rotate(${tilt}deg)`);

  let wake = () => {};
  if (kind === 'preview') {
    // Not saved yet: the space a stamp would go, with a plus to fill it.
    css(card, `${card.style.cssText};box-sizing:border-box;border:2px dashed ${PAPER};border-radius:3px;`
      + 'background:rgba(20,18,16,.45);display:grid;place-items:center');
    card.innerHTML = PLUS;
  } else {
    const mask = perforation(w, h, mini ? 5 : 6, mini ? 1.5 : 2);
    const paper = div(`width:100%;height:100%;box-sizing:border-box;padding:${mini ? 3 : 4}px;background:${PAPER};`
      + `-webkit-mask-image:${mask};mask-image:${mask};-webkit-mask-size:100% 100%;mask-size:100% 100%`);
    const frame = div(`position:relative;width:100%;height:100%;overflow:hidden;background:${ink}`);
    const src = thumbOf(point);
    if (src) {
      const img = css(document.createElement('img'), 'display:block;width:100%;height:100%;object-fit:cover');
      img.alt = '';
      img.decoding = 'async';
      // A photograph that will not load leaves the ink behind it, not a broken image.
      img.onerror = () => img.remove();
      wake = () => { if (!img.src) img.src = src; wake = () => {}; };
      frame.append(img);
    } else {
      // No photograph: the place's initial, engraved in paper on ink.
      const letter = div(`position:absolute;inset:0;display:grid;place-items:center;color:${PAPER};`
        + `font:400 ${mini ? 17 : 26}px/1 var(--font-serif), Georgia, serif`);
      letter.textContent = String(point.name || '?').trim().charAt(0).toUpperCase();
      frame.append(letter);
    }
    if (!mini) {
      // The engraved rule inside a stamp's border, in the kind's ink.
      frame.append(div(`position:absolute;inset:0;box-shadow:inset 0 0 0 1.5px ${ink},inset 0 0 0 2.5px rgba(252,250,244,.55)`));
    }
    paper.append(frame);
    card.append(paper);
    if (kind === 'been') {
      const mark = div('position:absolute;right:-12px;top:-8px;width:46px;height:26px;transform:rotate(-8deg)');
      mark.innerHTML = postmark(ink);
      card.append(mark);
    } else if (kind === 'want') {
      const star = div(`position:absolute;right:-7px;top:-7px;width:18px;height:18px;border-radius:50%;background:${ink};`
        + `display:grid;place-items:center;box-shadow:0 0 0 2px ${PAPER}`);
      star.innerHTML = STAR;
      card.append(star);
    }
  }

  const stem = div(`width:2px;height:${mini ? 6 : 10}px;background:${PAPER}`);
  const dot = div(`width:${mini ? 5 : 8}px;height:${mini ? 5 : 8}px;border-radius:50%;`
    + `background:${kind === 'preview' ? '#2b2724' : ink};box-shadow:0 0 0 2px ${PAPER}`);
  root.append(card, stem, dot);

  let selected = null;
  return {
    el: root,
    wake: () => wake(),
    select(on) {
      if (on === selected) return;
      selected = on;
      // A chosen idea grows to the size of your own stamps, so it leads the
      // town stamps around it rather than sitting half-hidden among them.
      root.style.transform = on ? `scale(${mini ? 1.55 : 1.3})` : '';
      card.style.transform = `rotate(${on ? 0 : tilt}deg)`;
    },
  };
}
