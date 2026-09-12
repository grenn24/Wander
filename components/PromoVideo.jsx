'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Play, ChevronUp } from 'lucide-react';

export default function PromoVideo() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tour = useRef(null);
  useEffect(() => {
    if (open) tour.current?.scrollIntoView({ block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [open]);
  return (
    <div className="lp-tour" id="tour" ref={tour}>
      <button type="button" className="btn lp-tour-toggle" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronUp size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        {open ? 'Close the tour' : 'Watch the 18-second tour'}
      </button>
      <div id={id} hidden={!open} className="lp-tour-player">
        {open && <>
          <p id={`${id}-description`}>Describe a trip, explore its map and follow your stops.</p>
          {/* Mount on demand so the homepage never downloads or plays the video before a click. */}
          <video src="/promo/wander-promo.mp4" controls playsInline autoPlay preload="metadata"
            width={720} height={1280} aria-label="Wander: an 18-second tour"
            aria-describedby={`${id}-description`}>
            <a href="/promo/wander-promo.mp4">Download the Wander tour</a>
          </video>
        </>}
      </div>
    </div>
  );
}
