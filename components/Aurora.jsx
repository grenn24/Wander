'use client';
import { useEffect, useRef } from 'react';

/**
 * The landing page's living background.
 *
 * Three sources of movement, layered:
 *   - each colour field drifts on its own slow timer, so it never stops and
 *     never repeats the same composite;
 *   - the whole thing leans towards the pointer;
 *   - scrolling slides the layers at different rates, which reads as depth.
 *
 * Pointer and scroll are both eased, so nothing snaps when input is jumpy.
 * The app pages get a far quieter wash instead; this is the one place where
 * movement is the point.
 *
 * Purely decorative, so it is hidden from assistive tech and stands down
 * entirely for prefers-reduced-motion.
 */
export default function Aurora() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let targetS = 0;
    let x = 0;
    let y = 0;
    let sy = 0;

    // Scroll in screen-heights, so the parallax reads the same on any display.
    const readScroll = () => window.scrollY / Math.max(1, window.innerHeight);

    function tick() {
      raf = 0;
      x += (targetX - x) * 0.055;
      y += (targetY - y) * 0.055;
      // Tighter easing on scroll so the layers feel attached to the page.
      sy += (targetS - sy) * 0.16;

      el.style.setProperty('--px', x.toFixed(4));
      el.style.setProperty('--py', y.toFixed(4));
      el.style.setProperty('--sy', sy.toFixed(4));

      if (Math.abs(targetX - x) > 0.001
        || Math.abs(targetY - y) > 0.001
        || Math.abs(targetS - sy) > 0.0005) {
        raf = requestAnimationFrame(tick);
      }
    }

    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

    const onMove = (e) => {
      targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetY = (e.clientY / window.innerHeight - 0.5) * 2;
      kick();
    };
    const onScroll = () => { targetS = readScroll(); kick(); };
    const onResize = () => { targetS = readScroll(); kick(); };

    targetS = readScroll();
    sy = targetS;
    kick();

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="aurora" ref={ref} aria-hidden="true">
      <span className="aurora-blob b1" />
      <span className="aurora-blob b2" />
      <span className="aurora-blob b3" />
      <span className="aurora-blob b4" />
      <span className="aurora-sheen" />
      <span className="aurora-grain" />
    </div>
  );
}
