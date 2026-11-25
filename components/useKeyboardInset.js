'use client';
import { useEffect, useState } from 'react';
import { keyboardInset, takesTyping } from '@/lib/keyboardInset';

/**
 * The height of the on-screen keyboard over the bottom of the window, kept up
 * to date while it opens, closes and the page scrolls under it. 0 with no
 * keyboard, and always 0 where there is no visual viewport to ask.
 *
 * Read on the next frame rather than as each event lands: focus moves before
 * the keyboard does, and a keyboard opening reports a resize and a scroll
 * together.
 */
export default function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setInset(keyboardInset({
          innerHeight: window.innerHeight,
          height: vv.height,
          offsetTop: vv.offsetTop,
          scale: vv.scale,
          editing: takesTyping(document.activeElement),
        }));
      });
    };
    read();
    vv.addEventListener('resize', read);
    vv.addEventListener('scroll', read);
    document.addEventListener('focusin', read);
    document.addEventListener('focusout', read);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', read);
      vv.removeEventListener('scroll', read);
      document.removeEventListener('focusin', read);
      document.removeEventListener('focusout', read);
    };
  }, []);

  return inset;
}
