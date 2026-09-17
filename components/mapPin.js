/*
 * The one map marker: a circle with a white ring, a number or a photograph in
 * it, and the colour of the day or the kind of place it marks.
 *
 * It is the journal's route map's pin (Journeys.module.css, .pin), made into
 * something every map can use — the trip map on flat and 3D ground, and the
 * globe — so a stop looks the same wherever it is shown, and responds the same
 * way: a pointer over it enlarges it with a halo in its own colour, the chosen
 * one stays a little larger, and a stop left out of the plan fades.
 *
 * Plain DOM with inline styles: the maps own these elements, and the 3D map
 * does not carry the page's stylesheets into its markers. Hover is handled
 * here rather than with :hover for the same reason.
 */

const WHITE = '#ffffff';
const DARK = '#1d1b18';
// The journal's pin before a stop has a day or a kind to take a colour from.
export const PIN_BROWN = '#5c534a';

/** Red, green and blue out of the colours the maps use: #rrggbb, rgb() or hsl(). */
export function rgbOf(css) {
  const s = String(css || '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const nums = (s.match(/-?[\d.]+/g) || []).map(Number);
  if (/^rgba?\(/i.test(s)) return nums.slice(0, 3);
  if (/^hsla?\(/i.test(s) && nums.length >= 3) {
    const [h, sat, light] = [nums[0], nums[1] / 100, nums[2] / 100];
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = light - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r, g, b].map((v) => Math.round((v + m) * 255));
  }
  return [92, 83, 74];
}

/*
 * The number's colour on the pin's: days walk round the hue circle, and white
 * on the yellow, green and cyan days all but disappears. By perceived
 * brightness, not by hue.
 */
export function inkOn(colour) {
  const [r, g, b] = Array.isArray(colour) ? colour : rgbOf(colour);
  return 0.299 * r + 0.587 * g + 0.114 * b > 130 ? DARK : WHITE;
}

const BADGE_SVG = {
  tick: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="2.6"/><path d="M12 7.5V12l3 2" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>',
  heart: '<path fill="#fff" d="M12 20.3l-1.3-1.2C5.9 14.8 3 12.1 3 8.8 3 6.1 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.1 21 8.8c0 3.3-2.9 6-7.7 10.3L12 20.3z"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="#fff" stroke-width="3" stroke-linecap="round"/>',
};

/**
 * A pin.
 *
 *   label    what is written in it: a stop's number, or nothing
 *   colour   its fill
 *   photo    a photograph to fill it instead, for a place rather than a stop
 *   size     its width; 26 is the journal's
 *   badge    { colour, glyph: 'tick' | 'clock' | 'heart' | 'plus' } on its shoulder
 *   name     what a pointer over it shows, and what a screen reader says
 *   lift     true on Google's flat map, which stands a marker above its point:
 *            it is moved down half its height to sit centred on it instead
 *   onHover  called with true and false as a pointer arrives and leaves
 *
 * Returns the element, `set` to change its state, and `wake` to start its
 * photograph loading, which is left until the pin is first shown.
 */
export function createPin({
  label = '', colour = PIN_BROWN, photo = null, size = 26, badge = null, name = '', lift = false, onHover = null,
} = {}) {
  const rgb = rgbOf(colour);
  const ring = `rgba(${rgb.join(', ')}, 0.45)`;
  const shadow = '0 2px 6px rgba(0, 0, 0, 0.45)';
  const holder = document.createElement('div');
  holder.style.cssText = `position:relative;width:${size}px;height:${size}px;`
    + 'transition:transform .25s cubic-bezier(.2,.7,.2,1);cursor:pointer;';

  const pin = document.createElement('div');
  pin.style.cssText = `box-sizing:border-box;width:100%;height:100%;border-radius:50%;border:2px solid ${WHITE};`
    + `background:${colour} center / cover no-repeat;color:${inkOn(rgb)};display:grid;place-items:center;`
    + `font:700 ${Math.round(size * 0.44)}px/1 var(--font-mono), ui-monospace, "SFMono-Regular", Menlo, monospace;`
    + `box-shadow:${shadow};opacity:.92;transition:box-shadow .25s ease, opacity .25s ease, background-color .25s ease;`;
  if (label !== '' && label != null) pin.textContent = String(label);
  holder.append(pin);

  let wake = () => {};
  if (photo) {
    wake = () => {
      const img = new Image();
      img.onload = () => { pin.style.backgroundImage = `url("${photo}")`; };
      img.src = photo;
      wake = () => {};
    };
  }

  if (badge && BADGE_SVG[badge.glyph]) {
    const b = Math.max(16, Math.round(size * 0.42));
    const mark = document.createElement('div');
    mark.style.cssText = `position:absolute;right:${-Math.round(b * 0.28)}px;top:${-Math.round(b * 0.28)}px;`
      + `width:${b}px;height:${b}px;border-radius:50%;background:${badge.colour};box-shadow:0 0 0 2px ${WHITE};`
      + 'display:grid;place-items:center;';
    mark.innerHTML = `<svg width="${Math.round(b * 0.58)}" height="${Math.round(b * 0.58)}" viewBox="0 0 24 24" aria-hidden="true">${BADGE_SVG[badge.glyph]}</svg>`;
    holder.append(mark);
  }

  if (name) {
    // The app's own tooltip, not the operating system's: see components/Tips.
    holder.dataset.tip = name;
    holder.setAttribute('aria-label', name);
  }

  const state = { active: false, hover: false, off: false };
  function paint() {
    const k = state.hover ? 1.4 : state.active ? 1.2 : 1;
    holder.style.transform = `${lift ? `translateY(${size / 2}px) ` : ''}scale(${k})`;
    holder.style.zIndex = state.hover || state.active ? '2' : '';
    pin.style.opacity = state.off ? '.55' : state.hover || state.active || photo ? '1' : '.92';
    pin.style.boxShadow = state.hover || state.active ? `0 0 0 ${state.hover ? 6 : 4}px ${ring}, ${shadow}` : shadow;
    pin.style.filter = state.off ? 'grayscale(1)' : '';
    pin.style.textDecoration = state.off ? 'line-through' : '';
  }
  paint();

  holder.addEventListener('pointerenter', () => { state.hover = true; paint(); if (onHover) onHover(true); });
  holder.addEventListener('pointerleave', () => { state.hover = false; paint(); if (onHover) onHover(false); });

  return {
    el: holder,
    wake: () => wake(),
    /** Change any of { active, hover, off }; the rest stay as they are. */
    set(next) {
      let changed = false;
      Object.keys(next).forEach((k) => {
        if (k in state && state[k] !== !!next[k]) { state[k] = !!next[k]; changed = true; }
      });
      if (changed) paint();
    },
  };
}

/**
 * Several stops in one marker, where their pins would pile up at this zoom.
 *
 * A darker circle than any stop, with how many it holds in the middle, a ring
 * in the colours of the days those stops belong to, and a second circle just
 * behind it, so it reads as a stack rather than as one more numbered stop.
 *
 *   count    how many stops
 *   colours  their days' colours, each once, in the order the stops come
 *   name     what a pointer over it shows, and what a screen reader says
 *   lift     as for a pin, on Google's flat map
 */
export function createCluster({ count, colours = [], name = '', size = 34, lift = false } = {}) {
  const ink = '#2b2724';
  const days = colours.length ? colours : [PIN_BROWN];
  const step = 360 / days.length;
  const ring = days.length === 1
    ? `linear-gradient(${days[0]}, ${days[0]})`
    : `conic-gradient(${days.map((c, i) => `${c} ${Math.round(i * step)}deg ${Math.round((i + 1) * step)}deg`).join(', ')})`;

  const holder = document.createElement('div');
  holder.style.cssText = `position:relative;width:${size}px;height:${size}px;cursor:pointer;`
    + 'transition:transform .2s cubic-bezier(.2,.7,.2,1);';

  const behind = document.createElement('div');
  behind.style.cssText = `position:absolute;inset:0;border-radius:50%;background:${ink};`
    + `border:2px solid ${WHITE};transform:translate(4px,-4px);opacity:.75;box-sizing:border-box;`;
  holder.append(behind);

  const face = document.createElement('div');
  face.style.cssText = 'position:absolute;inset:0;box-sizing:border-box;border-radius:50%;border:3px solid transparent;'
    + `background:linear-gradient(${ink}, ${ink}) padding-box, ${ring} border-box;`
    + `color:${WHITE};display:grid;place-items:center;`
    + `font:700 ${Math.round(size * 0.4)}px/1 var(--font-mono), ui-monospace, "SFMono-Regular", Menlo, monospace;`
    + 'box-shadow:0 0 0 1.5px rgba(255,255,255,.9), 0 2px 6px rgba(0,0,0,.45);';
  face.textContent = String(count);
  holder.append(face);

  if (name) {
    holder.dataset.tip = name;
    holder.setAttribute('aria-label', name);
  }
  const paint = (hover) => {
    holder.style.transform = `${lift ? `translateY(${size / 2}px) ` : ''}scale(${hover ? 1.12 : 1})`;
  };
  paint(false);
  holder.addEventListener('pointerenter', () => paint(true));
  holder.addEventListener('pointerleave', () => paint(false));
  return { el: holder };
}
