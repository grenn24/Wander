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

  // Keyed on what the pictures are rather than on the array holding them, so a
  // caller that rebuilds the list without changing it does not clear this.
  const key = photos.map((p) => p && p.ref).join('|');
  useEffect(() => { setBroken({}); }, [key]);

  const shown = photos.filter((p) => p && p.ref && !broken[p.ref]).slice(0, 6);
  if (!shown.length) return null;

  return (
    <>
      <div className="aphotos">
        {shown.map((p, i) => (
          <button key={p.ref} type="button" className="aphoto"
            data-tip={p.author ? `Photo by ${p.author}` : 'Full size'}
            aria-label={`Photo ${i + 1} of ${shown.length}${title ? ` — ${title}` : ''}`}
            onClick={() => setAt(i)}>
            <img src={`/api/places/photo?ref=${encodeURIComponent(p.ref)}&w=420`} alt=""
              loading="lazy"
              onError={() => setBroken((b) => ({ ...b, [p.ref]: true }))} />
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
