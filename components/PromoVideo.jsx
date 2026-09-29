'use client';

import { useEffect, useId, useRef } from 'react';

export default function PromoVideo() {
  const id = useId();
  const videoRef = useRef(null);
  useEffect(() => {
    const video = videoRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!video || !window.IntersectionObserver) return undefined;
    let inView = false;
    let started = false;
    let resume = false;
    const update = () => {
      if (reducedMotion.matches) {
        video.pause();
        resume = false;
        return;
      }
      if (!inView || document.visibilityState === 'hidden') {
        resume = resume || (!video.paused && !video.ended);
        video.pause();
      } else if (!started || resume) {
        started = true;
        resume = false;
        // Autoplay restrictions leave the poster and native play control usable.
        video.play().catch(() => {});
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting && entry.intersectionRatio >= 0.35;
      update();
    }, { threshold: 0.35 });
    observer.observe(video);
    document.addEventListener('visibilitychange', update);
    reducedMotion.addEventListener('change', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
      reducedMotion.removeEventListener('change', update);
      video.pause();
    };
  }, []);
  return (
    <figure className="lp-tour" id="tour">
      <div className="lp-phone">
        <video ref={videoRef} src="/promo/wander-promo.mp4" poster="/promo/wander-promo-poster.jpg"
          controls playsInline muted preload="none"
          onEnded={(event) => event.currentTarget.load()}
          width={720} height={1280} aria-label="Wander: an 18-second tour"
          aria-describedby={`${id}-description`}>
          <a href="/promo/wander-promo.mp4">Download the Wander tour</a>
        </video>
      </div>
      <figcaption id={`${id}-description`}>
        <strong>See it in 18 seconds</strong>
        Describe a trip, explore its map and follow your stops.
      </figcaption>
    </figure>
  );
}
