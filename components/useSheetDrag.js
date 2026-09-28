'use client';
import { useCallback, useEffect, useRef } from 'react';
import { SLOP, settleOn, stiffen } from '@/lib/sheetSnap';

/*
 * A sheet you can pull.
 *
 * The grip stays a button — a tap steps through the sizes, and a keyboard or a
 * screen reader reaches it the same way — and this adds the gesture its shape
 * has been promising: the sheet follows your finger and settles at whichever
 * size it is nearest, unless the flick was quick, in which case the direction
 * decides and not the distance.
 *
 * The sizes are not written down here. Each is measured off the sheet itself
 * the moment a drag starts, by trying the sizes on with transitions switched
 * off and reading the height back, all inside the one event so nothing is ever
 * painted mid-measure. So the CSS keeps saying how tall a sheet is at each
 * size, as it does for every sheet that cannot be dragged.
 *
 * Transitions stay off from the first measurement until the finger lifts. Turn
 * them back on a moment too early and the sheet is still on its way somewhere
 * when it is asked how tall it is, and answers with a height it no longer has.
 *
 * Where it settles is arithmetic, and lives in lib/sheetSnap.js where it can
 * be checked without a browser.
 */
const SETTLING = 280;

export default function useSheetDrag({ ref, sizes, size, onSize, apply }) {
  const drag = useRef(null);
  const moved = useRef(false);
  const settling = useRef(null);

  useEffect(() => () => clearTimeout(settling.current), []);

  const set = useCallback((el, name) => {
    if (apply) apply(el, name); else el.dataset.size = name;
  }, [apply]);

  /* Back to a sheet the stylesheet is in charge of. */
  const release = useCallback((el) => {
    clearTimeout(settling.current);
    settling.current = null;
    el.style.height = '';
    el.style.maxHeight = '';
    el.style.overflow = '';
    delete el.dataset.settling;
  }, []);

  const start = useCallback((event) => {
    const el = ref.current;
    // A second finger is not a second drag. A first one always is, though: if
    // a press ended somewhere this never heard about, the drag it left behind
    // is stale, and this one replaces it rather than being refused.
    if (!el || event.button > 0 || !event.isPrimary) return;
    if (drag.current) { drag.current = null; release(el); }
    // Whatever the last press was, this one has not wandered yet — so a press
    // that never becomes a drag, here or on a screen too wide to have a sheet
    // to pull, still reaches the button as the tap it is.
    moved.current = false;
    if (el.offsetWidth < (el.offsetParent ? el.offsetParent.clientWidth : innerWidth) * 0.8) return;
    clearTimeout(settling.current);

    /*
     * A sheet that has been handled does not play its entrance again.
     *
     * The slide up from below the screen belongs to a sheet arriving. While
     * one is being dragged it has to be off, or it would fight the hand — and
     * a rule that turns an animation off and on again does not resume it, it
     * starts it afresh, so the sheet would leap off the screen and slide back
     * the moment the finger lifted. It stays off, from the first drag until
     * this sheet is gone from the page, and the heights do the moving.
     */
    el.dataset.dragged = '';
    el.dataset.measuring = '';
    const heights = sizes.map((name) => { set(el, name); return el.getBoundingClientRect().height; });
    set(el, size);

    const from = el.getBoundingClientRect().height;
    drag.current = {
      id: event.pointerId, y: event.clientY, at: event.timeStamp, from, heights,
      last: event.clientY, speed: 0,
    };
    el.dataset.dragging = '';
    el.style.maxHeight = 'none';
    el.style.height = `${from}px`;
    el.style.overflow = 'hidden';
    /*
     * Dressed as its largest size for the length of the drag, so what a sheet
     * only shows when it is open — a list of days, the places under a map — is
     * there to be uncovered as it rises, rather than appearing at the end. The
     * height is the sheet's own by now, so nothing moves on account of this.
     */
    set(el, sizes[heights.indexOf(Math.max(...heights))]);
    // Only now: being dragged holds the transitions off from here.
    delete el.dataset.measuring;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* it will follow anyway */ }
  }, [ref, sizes, size, set, release]);

  const move = useCallback((event) => {
    const el = ref.current;
    const d = drag.current;
    // Only the finger that started this one has any say in it.
    if (!el || !d || d.id !== event.pointerId) return;
    const h = stiffen(d.from + (d.y - event.clientY), Math.min(...d.heights), Math.max(...d.heights));
    const gap = event.timeStamp - d.at;
    if (gap > 0) d.speed = (d.last - event.clientY) / gap;
    d.last = event.clientY;
    d.at = event.timeStamp;
    if (Math.abs(event.clientY - d.y) > SLOP) moved.current = true;
    el.style.height = `${Math.round(h)}px`;
  }, [ref]);

  const end = useCallback((event) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d || d.id !== event.pointerId) return;
    drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already gone */ }

    const at = settleOn(d.heights, {
      from: d.from,
      height: el.getBoundingClientRect().height,
      speed: d.speed,
      moved: moved.current,
    });
    /*
     * It goes to the size it settled on rather than snapping there: the sheet
     * keeps a height of its own for the length of that journey, with
     * transitions back on, and the stylesheet takes it back afterwards.
     */
    delete el.dataset.dragging;
    el.dataset.settling = '';
    set(el, sizes[at]);
    el.style.height = `${Math.round(d.heights[at])}px`;
    settling.current = setTimeout(() => { if (!drag.current) release(el); }, SETTLING);
    if (sizes[at] !== size) onSize(sizes[at]);
  }, [ref, sizes, size, onSize, release, set]);

  /*
   * True when the press that just ended was a drag, so the tap can stand down
   * — and only for that one click. A click can also arrive with no press at
   * all, from a keyboard or a screen reader, and that is always a tap.
   */
  const dragged = useCallback(() => {
    const was = moved.current;
    moved.current = false;
    return was;
  }, []);

  return {
    dragged,
    handlers: {
      onPointerDown: start,
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: end,
      // The browser can take the pointer away — a system gesture, a scroll it
      // decided was its own — and that is the end of the drag too.
      onLostPointerCapture: end,
    },
  };
}
