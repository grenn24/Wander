'use client';
import { useRef } from 'react';

/**
 * The feature grid, with a light that follows the pointer across the cards.
 *
 * Only the pointer handling lives on the client — the cards themselves are
 * passed in already rendered, because icon components are functions and those
 * cannot cross a server/client boundary as props.
 *
 * One listener on the grid rather than one per card, writing CSS custom
 * properties rather than styles the browser has to reconcile: the highlight
 * costs two variable writes per frame and the compositor does the rest. Touch
 * devices never fire it and lose nothing.
 */
export default function FeatureGrid({ children }) {
  const ref = useRef(null);
  const raf = useRef(0);

  function onMove(e) {
    const card = e.target.closest && e.target.closest('.lp-card');
    if (!card || !ref.current || !ref.current.contains(card)) return;
    const { clientX, clientY } = e;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const b = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${((clientX - b.left) / b.width) * 100}%`);
      card.style.setProperty('--my', `${((clientY - b.top) / b.height) * 100}%`);
    });
  }

  return (
    <div className="lp-grid" ref={ref} onPointerMove={onMove}>
      {children}
    </div>
  );
}
