'use client';
import { useEffect, useState } from 'react';
import Lightbox from '@/components/Lightbox';
import { placePhotos } from '@/lib/geo';

/**
 * What the place looks like, in the editor.
 *
 * A location is a line of text and a dot on a map, neither of which tells you
 * whether it is the right place — a photo does that in a glance, which is the
 * whole reason the trip list already shows one. Here there is room for more
 * than a thumbnail, so the rest of the place's photos are worth asking for.
 *
 * Only a pinned activity has photos: the reference belongs to a specific place
 * in Google's index, and a line of text has not been resolved to one yet.
 */
export default function ActivityPhotos({ placeId, photoRef, given, title }) {
  const [photos, setPhotos] = useState(given || (photoRef ? [photoRef] : []));
  const [broken, setBroken] = useState({});
  const [at, setAt] = useState(-1); // which one the viewer is showing

  useEffect(() => {
    // A search result arrives with its photos attached, so there is nothing to
    // go and ask for.
    if (given) { setPhotos(given); setBroken({}); return undefined; }
    setPhotos(photoRef ? [photoRef] : []);
    setBroken({});
    if (!placeId) return undefined;
    let alive = true;
    placePhotos(placeId)
      .then((list) => {
        if (!alive || !list.length) return;
        // The saved reference first: it is the one already on the card
        // elsewhere in the app, so the strip opens with a familiar picture.
        const rest = list.filter((r) => r !== photoRef);
        setPhotos(photoRef ? [photoRef, ...rest] : rest);
      })
      .catch(() => { /* the one saved photo is still worth showing */ });
    return () => { alive = false; };
  }, [placeId, photoRef, given]);

  const shown = photos.filter((r) => !broken[r]).slice(0, 6);
  if (!shown.length) return null;

  return (
    <>
      <div className="aphotos">
        {shown.map((ref, i) => (
          <button key={ref} type="button" className="aphoto"
            title="See it full size"
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
