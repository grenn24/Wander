'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Keeps a component mounted long enough to animate itself out.
 *
 * React removes an element the instant its condition goes false, which is why
 * nearly everything in this app could animate in and nothing could animate
 * out — things arrived politely and then simply vanished. This holds the
 * element for the length of its exit transition and reports which half of the
 * transition it is in, leaving the actual movement to CSS.
 *
 * `state` starts at 'exit' even when it opens mounted, because a transition
 * needs a frame of the "before" to move away from.
 *
 * Returns { mounted, state } where state is 'enter' | 'exit'.
 */
export default function usePresence(open, ms = 170) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState('exit');
  const timer = useRef(0);

  useEffect(() => {
    clearTimeout(timer.current);

    if (open) {
      setMounted(true);
      // Two frames: one to get it into the DOM at its "before" values, one for
      // the browser to notice them. A single frame lands too early in Safari.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setState('enter'));
      });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }

    setState('exit');
    timer.current = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer.current);
  }, [open, ms]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { mounted, state };
}
