'use client';
import { useEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import Lightbox from '@/components/Lightbox';
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
 * The whole frame opens the picture in the app's image viewer. That is a
 * button lying under the words rather than around them: a heading inside a
 * button is not a heading any more, and the name stays a heading to a screen
 * reader. The words let clicks through to it. The corner mark is for touch,
 * which has no pointer to change shape over something that opens.
 *
 * A picture that cannot be loaded says so and the page goes back to its plain
 * heading (see heroCoverURL) rather than keep an empty box. Failure and load
 * both belong to one address, so a new cover starts afresh.
 */
export default function TripHero({ url, photo, label, onBroken, children }) {
  return <Hero key={url} url={url} photo={photo} label={label} onBroken={onBroken}>{children}</Hero>;
}

function Hero({ url, photo, label, onBroken, children }) {
  const [loaded, setLoaded] = useState(false);
  const [viewing, setViewing] = useState(false);
  const img = useRef(null);
  const opener = useRef(null);

  // A picture already in the cache can be complete before React is listening.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth) setLoaded(true);
  }, []);

  function close() {
    setViewing(false);
    // Back to the frame it was opened from, so the keyboard carries on from there.
    if (opener.current) opener.current.focus({ preventScroll: true });
  }

  return (
    <>
      <div className={s.hero}>
        <img ref={img} src={url} alt="" decoding="async" fetchPriority="high"
          className={`${s.pic}${loaded ? ` ${s.in}` : ''}`}
          onLoad={() => setLoaded(true)} onError={onBroken} />
        {/* Not offered until there is a picture to open, or the viewer would
            open on a spinner over a frame that is still empty. */}
        {loaded && photo ? (
          <>
            <button ref={opener} type="button" className={s.open} aria-haspopup="dialog"
              aria-label={`View cover photo${label ? ` for ${label}` : ''}`}
              onClick={() => setViewing(true)} />
            <span className={s.mark} aria-hidden="true"><Maximize2 size={15} /></span>
          </>
        ) : null}
        <div className={s.text}>{children}</div>
      </div>

      {viewing && photo ? (
        <Lightbox photos={[photo]} index={0} alt={label ? `Cover photo for ${label}` : 'Cover photo'}
          onIndex={() => {}} onClose={close} />
      ) : null}
    </>
  );
}
