'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import Lightbox from '@/components/Lightbox';

/**
 * The pictures attached to a request, before it is sent.
 *
 * Thumbnails and nothing else. A filename beside each one said nothing anybody
 * needed — "IMG_4471.jpg" is not a description of a photograph, and four of
 * them turned a strip you could take in at a glance into a list to be read.
 * The picture is its own label, and clicking it opens the same viewer the rest
 * of the app uses, because "is that the right one" is a question best answered
 * at full size.
 */
export default function ShotStrip({ shots, onRemove, disabled = false, className = '' }) {
  const [at, setAt] = useState(-1);
  if (!shots.length) return null;

  return (
    <>
      <div className={`shotstrip ${className}`.trim()}>
        {shots.map((s, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div className="shot" key={`${s.name}-${i}`}>
            <button type="button" className="shot-open"
              data-tip="See it full size"
              aria-label={`Picture ${i + 1} of ${shots.length}`}
              onClick={() => setAt(i)}>
              <img src={s.url} alt="" />
            </button>
            {onRemove ? (
              <button type="button" className="shot-x" data-tip="Remove"
                aria-label={`Remove picture ${i + 1}`} disabled={disabled}
                onClick={() => onRemove(i)}>
                <X size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {at >= 0 && shots[at] ? (
        <Lightbox photos={shots} index={at} alt="Attached picture"
          onIndex={setAt} onClose={() => setAt(-1)} />
      ) : null}
    </>
  );
}
