'use client';
import { useCallback, useEffect, useRef } from 'react';
import { SLOP, letGo, stiffen } from '@/lib/sheetSnap';

/*
 * A sheet with one size, which can only be pushed away.
 *
 * On a phone every dialog is a sheet against the foot of the screen, and the
 * gesture that shape promises is a pull down to be rid of it. There is no
 * second height to settle at, so a pull either goes far enough — or fast
 * enough — to close the thing, or the sheet goes back where it was.
 *
 * The handle is the dialog's own head, the strip with its title: dragging from
 * the body would fight whatever is being scrolled or typed in there. A press
 * that starts on a button in the head belongs to the button.
 *
 * On a wide screen the dialog is centred and this does nothing at all, which
 * is decided by looking at where the dialog actually is rather than by
 * guessing at the width.
 */
const HANDLE = '.modal-head';
const CONTROLS = 'button, a, input, textarea, select, label, [role="button"]';
const BACK = 220;

export default function useSheetDismiss({ ref, onClose, handle = HANDLE }) {
  const drag = useRef(null);

  // A touch on the head is this gesture, not a scroll of the page behind it.
  useEffect(() => {
    const head = ref.current && ref.current.querySelector(handle);
    if (!head) return undefined;
    const had = head.style.touchAction;
    head.style.touchAction = 'none';
    return () => { head.style.touchAction = had; };
  }, [ref, handle]);

  const settle = useCallback((el, away) => {
    el.style.transition = away ? '' : `transform ${BACK}ms var(--ease)`;
    el.style.transform = away ? '' : 'translateY(0)';
    delete el.dataset.dragging;
    if (!away) setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, BACK);
  }, []);

  const start = useCallback((event) => {
    const el = ref.current;
    if (!el || event.button > 0 || !event.isPrimary || drag.current) return;
    if (!event.target.closest(handle) || event.target.closest(CONTROLS)) return;
    /*
     * A sheet across the foot of the screen, rather than a dialog centred in
     * it or a drawer down one side — both of which also reach the bottom, so
     * the width has to be asked about as well.
     */
    const box = el.getBoundingClientRect();
    const parent = el.offsetParent || el.parentElement;
    if (box.bottom < window.innerHeight - 2) return;
    if (parent && box.width < parent.clientWidth * 0.8) return;

    drag.current = {
      id: event.pointerId, y: event.clientY, at: event.timeStamp, last: event.clientY,
      down: 0, height: box.height, moved: false,
    };
    el.dataset.dragging = '';
    el.style.transition = 'none';
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* it will follow anyway */ }
  }, [ref, handle]);

  const move = useCallback((event) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d || d.id !== event.pointerId) return;
    const dy = event.clientY - d.y;
    const gap = event.timeStamp - d.at;
    if (gap > 0) d.down = (event.clientY - d.last) / gap;
    d.last = event.clientY;
    d.at = event.timeStamp;
    if (Math.abs(dy) > SLOP) d.moved = true;
    // Upwards there is nothing to open, so it holds rather than follows.
    el.style.transform = `translateY(${Math.round(stiffen(dy, 0, d.height))}px)`;
  }, [ref]);

  const end = useCallback((event) => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d || d.id !== event.pointerId) return;
    drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already gone */ }
    const dy = event.clientY - d.y;
    const away = d.moved && letGo({ dy, height: d.height, down: d.down });
    settle(el, away);
    if (away) onClose();
  }, [ref, onClose, settle]);

  return {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  };
}
