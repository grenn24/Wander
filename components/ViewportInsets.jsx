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

    /*
     * iOS only, and that is the point rather than laziness.
     *
     * What this measures is window height minus visible height, which says how
     * much browser chrome is in the way but not *where*. A bottom-anchored
     * toolbar is an iOS Safari thing; every other engine puts its chrome at the
     * top, where the same number is a top shrink being read as a bottom one —
     * on Chrome, the URL bar sliding back in during a fast scroll up lifted the
     * tab bar clean off the floor for the length of the animation.
     *
     * There is no reliable way to ask which end the missing pixels came from,
     * so the compensation is limited to the platform that needs it.
     */
    const ua = navigator.userAgent;
    const iOS = /iP(hone|od|ad)/.test(ua)
      // iPadOS reports itself as a Mac, and is told apart by having a touch screen.
      || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (!iOS) return undefined;

    const root = document.documentElement;

    const measure = () => {
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      // A toolbar is tens of pixels; a software keyboard is hundreds. Only the
      // first should lift our chrome — a bottom bar floating halfway up the
      // screen above an open keyboard is worse than one tucked behind it.
      return gap > 4 && gap < 140 ? Math.round(gap) : 0;
    };

    /*
     * Settled values only.
     *
     * Safari's toolbar collapses *while* you scroll, and the visual viewport
     * reports every intermediate size on the way. Writing each one straight
     * through made the tab bar climb the screen during a fast flick and drop
     * back at the end. Waiting for the value to hold still means the bar stays
     * where it is until the scroll is over, and then moves once.
     */
    let settle = 0;
    const apply = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        root.style.setProperty('--vv-bottom', `${measure()}px`);
      }, 160);
    };

    // The first reading is not mid-gesture, so it can land immediately.
    root.style.setProperty('--vv-bottom', `${measure()}px`);
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      clearTimeout(settle);
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);

  return null;
}
