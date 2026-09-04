'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltips that belong to this app rather than to the operating system.
 *
 * A native `title` is a yellow-ish box in the OS font, half a second late, in
 * nobody's theme, and impossible to style — on a dark glass interface it looks
 * like something went wrong. This is one element, mounted once at the root and
 * portalled into <body>, that any control can borrow by carrying `data-tip`.
 *
 * Body, not where it is used: half the controls in this app sit inside
 * something with backdrop-filter — the top bar, the modal backdrop, the map
 * panel — and that makes the ancestor the containing block for anything fixed
 * inside it. A tooltip left in place would be clipped by the very surfaces it
 * needs to escape.
 *
 * Hit-tested on movement rather than driven by pointerover, because a disabled
 * button emits no pointer events at all — and "why is this greyed out" is
 * exactly the question a tooltip should be answering.
 */

const DELAY = 340;
// Move between two controls quickly and the second appears at once, the way
// every toolbar does it. Pause, and the wait starts again.
const CHAIN = 500;
const GAP = 8;
const EDGE = 8;

export default function Tips() {
  const [mounted, setMounted] = useState(false);
  const [tip, setTip] = useState(null); // { text, box }
  const boxRef = useRef(null);
  const held = useRef(null); // the element being waited on
  const timer = useRef(0);
  const shownAt = useRef(0);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let raf = 0;
    let at = null;

    const drop = () => {
      clearTimeout(timer.current);
      held.current = null;
      setTip((t) => {
        if (t) shownAt.current = Date.now();
        return null;
      });
    };

    const raise = (el, now) => {
      if (el === held.current) return;
      clearTimeout(timer.current);
      held.current = el;
      const wait = now || Date.now() - shownAt.current < CHAIN ? 0 : DELAY;
      timer.current = setTimeout(() => {
        if (held.current !== el || !el.isConnected) return;
        setTip({ text: el.getAttribute('data-tip'), box: el.getBoundingClientRect(),
          kind: el.getAttribute('data-tip-kind'), detail: el.getAttribute('data-tip-detail') });
      }, wait);
    };

    const test = () => {
      raf = 0;
      if (!at) return;
      const under = document.elementFromPoint(at.x, at.y);
      const el = under && under.closest ? under.closest('[data-tip]') : null;
      if (el && el.getAttribute('data-tip')) raise(el);
      else if (held.current) drop();
    };

    const onMove = (e) => {
      // Touch has no hover, so a tooltip there is a box that appears when you
      // press something and says what you just pressed.
      if (e.pointerType && e.pointerType !== 'mouse') return;
      at = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(test);
    };

    const onFocus = (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      // Only for keyboard focus: clicking a button should not explain it after
      // the fact.
      if (!el || !el.matches(':focus-visible')) return;
      raise(el, true);
    };

    const onOut = () => { at = null; drop(); };
    const onKey = (e) => { if (e.key === 'Escape') drop(); };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', drop, true);
    document.addEventListener('pointerleave', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', drop);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', drop, true);
    window.addEventListener('blur', drop);

    return () => {
      clearTimeout(timer.current);
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', drop, true);
      document.removeEventListener('pointerleave', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', drop);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', drop, true);
      window.removeEventListener('blur', drop);
    };
  }, []);

  /*
   * Placed after it has been measured, not before. Centring on the control and
   * flipping above it both need the tooltip's own width and height, which only
   * exist once it has been laid out — so it is rendered transparent and made
   * visible in the same frame it is put in the right place.
   */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !tip) return;
    const self = el.getBoundingClientRect();
    const b = tip.box;

    let left = b.left + b.width / 2 - self.width / 2;
    left = Math.max(EDGE, Math.min(window.innerWidth - self.width - EDGE, left));

    let top = b.bottom + GAP;
    let above = false;
    if (top + self.height > window.innerHeight - EDGE) {
      top = b.top - self.height - GAP;
      above = true;
    }

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.max(EDGE, top))}px`;
    el.dataset.above = above ? 'true' : 'false';
    el.classList.add('is-on');
  }, [tip]);

  if (!mounted || !tip || !tip.text) return null;

  return createPortal((
    <div className={`tip${tip.kind === 'stay' ? ' tip-stay' : ''}`} ref={boxRef} role="tooltip" aria-hidden="true">
      {tip.kind === 'stay' ? <>
        <span className="tip-stay-name">{tip.text}</span>
        <span className="tip-stay-dates">{tip.detail}</span>
      </> : tip.text}
    </div>
  ), document.body);
}
