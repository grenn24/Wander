'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import usePresence from '@/components/usePresence';

/**
 * A layer that escapes the page.
 *
 * Every glass surface here sets backdrop-filter, and backdrop-filter creates a
 * stacking context — so an absolutely positioned menu is sealed inside
 * whichever card it was written in, and paints under anything that comes later
 * in the document no matter what z-index it asks for. Rendering into <body> at
 * a fixed position is the version of this that a parent's styling cannot break.
 *
 * Anchored popovers follow their trigger on scroll rather than closing, which
 * is what a menu attached to a row in a long list should do.
 */

// Open popovers, in the order they opened. A select opened from inside a menu
// registers after that menu, which is how the menu tells "clicked the select I
// opened" apart from "clicked somewhere else entirely".
const stack = [];

const MARGIN = 8; // keep clear of the viewport edge
const GAP = 6; // breathing room between trigger and panel

export default function Popover({
  anchorEl, open, onClose, align = 'end', match = false, width, className = '', children,
}) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [ready, setReady] = useState(false);
  // Held open for the length of its exit so it can animate away rather than
  // simply cease to exist.
  const { mounted, state } = usePresence(open, 150);

  // Portals need a DOM to aim at, so nothing renders during SSR.
  useEffect(() => { setReady(true); }, []);

  const place = useCallback(() => {
    const el = ref.current;
    if (!anchorEl || !el) return;
    const box = anchorEl.getBoundingClientRect();
    const w = match ? box.width : (width || el.offsetWidth || 214);
    const h = el.offsetHeight || 0;
    const below = window.innerHeight - box.bottom - GAP - MARGIN;
    const above = box.top - GAP - MARGIN;
    const flip = h > below && above > below;

    setPos({
      top: flip ? Math.max(MARGIN, box.top - GAP - h) : box.bottom + GAP,
      left: Math.min(
        Math.max(MARGIN, align === 'end' ? box.right - w : box.left),
        Math.max(MARGIN, window.innerWidth - w - MARGIN),
      ),
      width: w,
      maxHeight: Math.max(140, flip ? above : below),
    });
  }, [anchorEl, align, match, width]);

  // Measure before the browser paints, so it never shows up at the wrong place
  // first. `ready` matters: the portal only exists from the second render, so
  // the first pass here has no node to measure and has to run again after it.
  useLayoutEffect(() => {
    if (!mounted || !ready) { setPos(null); return; }
    place();
  }, [mounted, ready, place]);

  // Follow the trigger, and re-measure when the contents change size.
  useEffect(() => {
    if (!mounted || !ready) return undefined;
    const el = ref.current;
    const again = () => place();
    window.addEventListener('scroll', again, true);
    window.addEventListener('resize', again);
    let ro;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(again);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener('scroll', again, true);
      window.removeEventListener('resize', again);
      if (ro) ro.disconnect();
    };
  }, [mounted, ready, place]);

  useEffect(() => {
    if (!open) return undefined;
    const entry = { node: () => ref.current };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const inside = (target) => {
      const el = ref.current;
      if (el && el.contains(target)) return true;
      // The trigger handles its own toggle; closing here would fight it.
      if (anchorEl && anchorEl.contains(target)) return true;
      const mine = stack.findIndex((s) => s.node() === el);
      return stack.slice(mine + 1).some((s) => {
        const n = s.node();
        return n && n.contains(target);
      });
    };

    const onDown = (e) => { if (!inside(e.target)) onClose(); };

    // Escape belongs to the topmost layer only, so it peels them off one by one.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (!stack.length || stack[stack.length - 1].node() !== ref.current) return;
      e.stopPropagation();
      onClose();
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchorEl, onClose]);

  if (!mounted || !ready) return null;

  return createPortal(
    <div
      ref={ref}
      className={`pop${className ? ` ${className}` : ''}`}
      data-state={state}
      style={pos
        ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }
        : { top: 0, left: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
