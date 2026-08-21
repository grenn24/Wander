'use client';
import { useEffect } from 'react';

/**
 * Publishes how much of the bottom of the window is covered by browser chrome,
 * as --vv-bottom.
 *
 * On iOS Safari a `position: fixed; bottom: 0` element anchors to the layout
 * viewport, which extends underneath the browser's floating toolbar — so the
 * tab bar sits behind it and cannot be tapped. env(safe-area-inset-bottom) is
 * no help: it reports 0 in exactly the state where the toolbar is expanded and
 * covering things, and only becomes non-zero once the toolbar shrinks away.
 *
 * The visual viewport does know. The difference between the window and the
 * visible region is the chrome, and it updates as the toolbar grows and
 * collapses with scroll.
 */
export default function ViewportInsets() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const root = document.documentElement;

    const apply = () => {
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      // A toolbar is tens of pixels; a software keyboard is hundreds. Only the
      // first should lift our chrome — a bottom bar floating halfway up the
      // screen above an open keyboard is worse than one tucked behind it.
      const inset = gap > 4 && gap < 140 ? Math.round(gap) : 0;
      root.style.setProperty('--vv-bottom', `${inset}px`);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);

  return null;
}
