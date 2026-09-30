'use client';
import { useEffect, useRef, useState } from 'react';
import s from './TripHero.module.css';

/*
 * The trip's cover, with the trip's name laid over the foot of it.
 *
 * The name goes on the picture rather than under it so that a cover costs the
 * page only what it adds, not a banner on top of the heading: on a phone the
 * first stop of the day is still in sight. What makes that safe is the scrim.
 * A cover can be any photograph someone uploads, so the light text never leans
 * on the picture alone — it sits on a dark gradient that is there whatever the
 * photo is, and on a dark base before the photo has arrived, so the name reads
 * from the first frame and nothing moves when the picture lands.
 *
 * The frame is a minimum height, not a fixed one, so a long name or larger
 * text grows it instead of running out of the top.
 *
 * A picture that cannot be loaded says so and the page goes back to its plain
 * heading (see heroCoverURL) rather than keep an empty box. Failure and load
 * both belong to one address, so a new cover starts afresh.
 */
export default function TripHero({ url, onBroken, children }) {
  return <Hero key={url} url={url} onBroken={onBroken}>{children}</Hero>;
}

function Hero({ url, onBroken, children }) {
  const [loaded, setLoaded] = useState(false);
  const img = useRef(null);

  // A picture already in the cache can be complete before React is listening.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth) setLoaded(true);
  }, []);

  return (
    <div className={s.hero}>
      <img ref={img} src={url} alt="" decoding="async" fetchPriority="high"
        className={`${s.pic}${loaded ? ` ${s.in}` : ''}`}
        onLoad={() => setLoaded(true)} onError={onBroken} />
      <div className={s.text}>{children}</div>
    </div>
  );
}
