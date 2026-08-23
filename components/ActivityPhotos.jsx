'use client';
import { useEffect, useState } from 'react';
import Lightbox from '@/components/Lightbox';

/**
 * What the place looks like.
 *
 * A location is a line of text and a dot on a map, neither of which tells you
 * whether it is the right place — a photo does that in a glance.
 *
 * The pictures are handed in rather than fetched here: they arrive on the same
 * Place Details call as the rating and the reviews, and that call is billed by
 * the request, so it is made once by whoever needs any of it.
 */
export default function ActivityPhotos({ photos = [], title }) {
  const [broken, setBroken] = useState({});
  const [at, setAt] = useState(-1); // which one the viewer is showing

  useEffect(() => { setBroken({}); }, [photos]);

  const shown = photos.filter((r) => r && !broken[r]).slice(0, 6);
  if (!shown.length) return null;

  return (
    <>
      <div className="aphotos">
        {shown.map((ref, i) => (
          <button key={ref} type="button" className="aphoto"
            data-tip="Full size"
            aria-label={`Photo ${i + 1} of ${shown.length}${title ? ` — ${title}` : ''}`}
            onClick={() => setAt(i)}>
            <img src={`/api/places/photo?ref=${encodeURIComponent(ref)}&w=420`} alt=""
              loading="lazy"
              onError={() => setBroken((b) => ({ ...b, [ref]: true }))} />
          </button>
        ))}
      </div>

      {at >= 0 && shown[at] ? (
        <Lightbox photos={shown} index={at} alt={title || 'Photo of this place'}
          onIndex={setAt} onClose={() => setAt(-1)} />
      ) : null}
    </>
  );
}
