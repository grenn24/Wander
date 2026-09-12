'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/** One self-hosted illustration; only the route and light layers animate. */
export default function HeroAtlas() {
  const ref = useRef(null);
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const update = () => {
      setReduced(media.matches);
      setRunning(visible && document.visibilityState !== 'hidden' && !media.matches);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(ref.current);
    update();
    media.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return <>
    <div ref={ref} className="hero-atlas" aria-hidden="true" data-running={running && !paused}>
      <img className="hero-atlas-paper" src="/artwork/hero-atlas.webp" width={1920} height={1086}
        alt="" decoding="async" draggable={false} />
      <svg className="hero-atlas-routes" viewBox="0 0 1600 900" preserveAspectRatio="none" focusable="false">
        <g className="hero-atlas-route">
          <path className="atlas-trail" d="M 65 470 C 160 500 85 610 190 650 S 340 675 460 790" />
          <path className="atlas-ink" pathLength="100" d="M 65 470 C 160 500 85 610 190 650 S 340 675 460 790" />
          <circle cx="65" cy="470" r="5" /><circle cx="190" cy="650" r="5" /><circle cx="460" cy="790" r="5" />
        </g>
        <g className="hero-atlas-route route-later">
          <path className="atlas-trail" d="M 1220 65 C 1270 175 1405 130 1450 235 S 1370 440 1520 590" />
          <path className="atlas-ink" pathLength="100" d="M 1220 65 C 1270 175 1405 130 1450 235 S 1370 440 1520 590" />
          <circle cx="1220" cy="65" r="5" /><circle cx="1450" cy="235" r="5" /><circle cx="1520" cy="590" r="5" />
        </g>
      </svg>
      <div className="hero-atlas-light" />
    </div>
    {!reduced ? <button className="hero-atlas-toggle" type="button"
      aria-label={paused ? 'Play background animation' : 'Pause background animation'}
      data-tip={paused ? 'Play background animation' : 'Pause background animation'}
      onClick={() => setPaused((value) => !value)}>
      {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
    </button> : null}
  </>;
}
