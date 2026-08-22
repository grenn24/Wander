'use client';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

/**
 * A photo, full size, over everything else.
 *
 * Rendered into <body> rather than where it is used: the editor it opens from
 * sits inside a backdrop that sets backdrop-filter, and that makes the backdrop
 * the containing block for anything fixed inside it — a viewer left in place
 * would be trapped in the modal it is meant to cover.
 *
 * Keys are taken in the capture phase and stopped there, so Escape closes the
 * photo without also closing the editor underneath it. Both listen on the
 * document, and without this they would both answer the same press.
 */
export default function Lightbox({ photos, index, alt = '', onIndex, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const many = photos.length > 1;

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setLoaded(false); }, [index]);

  const step = useCallback((by) => {
    onIndex((index + by + photos.length) % photos.length);
  }, [index, photos.length, onIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight' && many) { e.stopPropagation(); step(1); }
      else if (e.key === 'ArrowLeft' && many) { e.stopPropagation(); step(-1); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, step, many]);

  if (!mounted) return null;

  const src = (ref, w) => `/api/places/photo?ref=${encodeURIComponent(ref)}&w=${w}`;

  return createPortal((
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt || 'Photo'}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button className="lb-x" type="button" aria-label="Close photo" onClick={onClose}>
        <X size={20} />
      </button>

      {many ? (
        <button className="lb-step lb-prev" type="button" aria-label="Previous photo"
          onClick={() => step(-1)}><ChevronLeft size={22} /></button>
      ) : null}

      <figure className="lb-frame">
        {loaded ? null : <Loader2 size={22} className="spin lb-wait" aria-label="Loading" />}
        <img src={src(photos[index], 1600)} alt={alt}
          onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
        {many ? (
          <figcaption className="lb-count">{index + 1} of {photos.length}</figcaption>
        ) : null}
      </figure>

      {many ? (
        <button className="lb-step lb-next" type="button" aria-label="Next photo"
          onClick={() => step(1)}><ChevronRight size={22} /></button>
      ) : null}
    </div>
  ), document.body);
}
