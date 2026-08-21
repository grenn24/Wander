'use client';
import { useEffect, useRef } from 'react';

/**
 * The landing page's living background: drifting colour fields that lean
 * gently towards the pointer. Purely decorative, so it is hidden from assistive
 * tech and stands down entirely for prefers-reduced-motion.
 */
export default function Aurora() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let raf = 0;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;

    const onMove = (e) => {
      // -1..1 from the centre of the viewport.
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    function tick() {
      raf = 0;
      // Ease towards the pointer so it drifts rather than snaps.
      x += (tx - x) * 0.06;
      y += (ty - y) * 0.06;
      el.style.setProperty('--px', x.toFixed(4));
      el.style.setProperty('--py', y.toFixed(4));
      if (Math.abs(tx - x) > 0.001 || Math.abs(ty - y) > 0.001) {
        raf = requestAnimationFrame(tick);
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="aurora" ref={ref} aria-hidden="true">
      <span className="aurora-blob b1" />
      <span className="aurora-blob b2" />
      <span className="aurora-blob b3" />
      <span className="aurora-grain" />
    </div>
  );
}
