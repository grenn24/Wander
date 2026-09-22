'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Pause, Play } from 'lucide-react';

/** Decorative motion is independent of progress; the text comes from the planner. */
export default function PlanningJourney({ status }) {
  const scene = useRef(null);
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
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer.observe(scene.current);
    media.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return <div className="planning-journey">
    <div ref={scene} className="planning-journey-scene" aria-hidden="true" data-running={running && !paused}>
      {/* The same atlas as the landing hero, cut to the screen asking (see HeroAtlas). */}
      <Image className="planning-journey-map" src="/artwork/hero-atlas.webp" width={1920} height={1086}
        sizes="100vw" quality={60} alt="" />
      <div className="planning-journey-track">
        <img className="planning-journey-train" src="/artwork/planning-train.webp" width="480" height="323" alt="" decoding="async" />
      </div>
    </div>
    <div className="planning-journey-caption">
      <p role="status" aria-live="polite" aria-atomic="true">{status}</p>
      {!reduced ? <button className="btn ghost icon-btn" type="button"
        aria-label={paused ? 'Play planning animation' : 'Pause planning animation'}
        onClick={() => setPaused((value) => !value)}>
        {paused ? <Play size={15} /> : <Pause size={15} />}
      </button> : null}
    </div>
  </div>;
}
