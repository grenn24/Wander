'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { imageURL, sourceOf } from '@/lib/guideFormat';
import {
  X, ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut,
} from 'lucide-react';

/**
 * A photo, full size, over everything else — and closer, if you want it.
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

const MAX = 6;
const STEP = 1.6;

/*
 * The width the strip already asked for. Reusing the exact number means the
 * small copy of the next photo is in the browser's cache before anyone clicks
 * next — it was fetched to draw the thumbnail.
 */
const THUMB = 420;

/** Whatever identifies this picture: a Google reference, a library link, or a data URL. */
const idOf = (p) => (p && (p.ref || p.url || p.raw)) || '';

/** A library photograph at a width, in whichever way its library asks for one. */
const sized = (photo, w) => imageURL(photo, w, 85);

/**
 * How big the full copy needs to be, snapped to a few sizes.
 *
 * A phone was being sent a 1600-pixel image to show in 375 points, which is
 * most of the wait for no visible gain. A large screen, though, was being sent
 * the same 1600 pixels to fill 2500 — which is what made photographs look soft
 * at full screen. Snapped rather than exact so that two devices a few pixels
 * apart share one cached image instead of each warming their own.
 */
function fullWidth() {
  if (typeof window === 'undefined') return 1200;
  const want = window.innerWidth * Math.min(2, window.devicePixelRatio || 1);
  return want <= 800 ? 800 : want <= 1200 ? 1200 : want <= 1600 ? 1600 : want <= 2400 ? 2400 : 3200;
}

export default function Lightbox({ photos, index, alt = '', onIndex, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const imgRef = useRef(null);
  const frameRef = useRef(null);
  // Live pointers, for dragging with one and pinching with two.
  const touches = useRef(new Map());
  const drag = useRef(null);
  const pinch = useRef(null);
  // Set while a drag is in progress, so letting go over the backdrop does not
  // read as a click on it and close the photo.
  const moved = useRef(false);
  // At most one gesture update per painted frame.
  const frame = useRef(0);
  // The current scale, readable from a listener that was bound once.
  const liveScale = useRef(1);

  const many = photos.length > 1;
  const zoomed = view.scale > 1.001;
  liveScale.current = view.scale;
  const wide = fullWidth();
  const shot = photos[index] || {};

  useEffect(() => { setMounted(true); }, []);
  // A new photo starts where the last one did, not wherever you had dragged to.
  useEffect(() => { setLoaded(false); setView({ scale: 1, x: 0, y: 0 }); }, [index]);

  /*
   * Keep the picture over its own footprint.
   *
   * offsetWidth is the layout size and ignores the transform, so the overflow
   * at a given scale is exactly half the extra width. Panning past that would
   * drag the image off into the dark, which is only ever an accident.
   */
  const clamp = useCallback((x, y, scale) => {
    const el = imgRef.current;
    if (!el || scale <= 1) return { x: 0, y: 0 };
    const mx = (el.offsetWidth * (scale - 1)) / 2;
    const my = (el.offsetHeight * (scale - 1)) / 2;
    return {
      x: Math.max(-mx, Math.min(mx, x)),
      y: Math.max(-my, Math.min(my, y)),
    };
  }, []);

  /**
   * Zoom about a point, so whatever is under the cursor stays under it. Without
   * this the picture slides away from what you were trying to look at.
   */
  const zoomTo = useCallback((next, originX, originY) => {
    setView((v) => {
      const scale = Math.max(1, Math.min(MAX, next));
      if (scale === v.scale) return v;
      if (scale === 1) return { scale: 1, x: 0, y: 0 };
      const el = imgRef.current;
      let { x, y } = v;
      if (el && originX != null) {
        const box = el.getBoundingClientRect();
        // Where the point sits relative to the middle of what is on screen.
        const dx = originX - (box.left + box.width / 2);
        const dy = originY - (box.top + box.height / 2);
        const k = scale / v.scale;
        x = v.x - dx * (k - 1);
        y = v.y - dy * (k - 1);
      }
      return { scale, ...clamp(x, y, scale) };
    });
  }, [clamp]);

  /**
   * Multiply the current scale, read from a ref rather than from the closure —
   * so a listener bound once still zooms from wherever the picture is now.
   */
  const zoomBy = useCallback((by, originX, originY) => {
    zoomTo(liveScale.current * by, originX, originY);
  }, [zoomTo]);

  const step = useCallback((by) => {
    onIndex((index + by + photos.length) % photos.length);
  }, [index, photos.length, onIndex]);

  /*
   * Fetch the pictures on either side while this one is being looked at.
   *
   * Clicking next used to start a request to Google through our own server and
   * then wait for it — half a second of nothing, every time. The neighbours
   * are almost always where you are going, so they arrive during the pause you
   * were taking anyway, and the click becomes instant.
   */
  useEffect(() => {
    if (!mounted || photos.length < 2) return;
    [1, -1].forEach((by) => {
      const at = (index + by + photos.length) % photos.length;
      if (at === index) return;
      // An attached picture is already here; there is nothing to fetch early.
      if (photos[at].url) return;
      const img = new Image();
      img.src = photos[at].raw
        ? sized(photos[at], fullWidth())
        : `/api/places/photo?ref=${encodeURIComponent(photos[at].ref)}&w=${fullWidth()}`;
    });
  }, [mounted, index, photos]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); e.preventDefault();
        // Escape backs out of the zoom first, then out of the photo — the same
        // order you got into them.
        if (zoomed) setView({ scale: 1, x: 0, y: 0 }); else onClose();
      } else if (e.key === 'ArrowRight' && many) { e.stopPropagation(); step(1); }
      else if (e.key === 'ArrowLeft' && many) { e.stopPropagation(); step(-1); }
      else if (e.key === '+' || e.key === '=') { e.stopPropagation(); zoomTo(view.scale * STEP); }
      else if (e.key === '-') { e.stopPropagation(); zoomTo(view.scale / STEP); }
      else if (e.key === '0') { e.stopPropagation(); setView({ scale: 1, x: 0, y: 0 }); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, step, many, zoomed, zoomTo, view.scale]);

  /*
   * The wheel is bound by hand because React's onWheel is passive, and a
   * passive listener may not call preventDefault — so the page behind would
   * scroll while the picture zoomed.
   */
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !mounted) return undefined;
    // Reads the scale out of the updater rather than out of the closure, so
    // this binds once instead of once per zoom step.
    const onWheel = (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.14 : 1 / 1.14, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mounted, zoomBy]);

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      pinch.current = { gap: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
      drag.current = null;
    } else if (zoomed) {
      drag.current = { x: e.clientX - view.x, y: e.clientY - view.y };
    }
  }

  /*
   * Pointer events arrive faster than a screen refreshes, and every one of them
   * used to be a React render. Coalescing to one per frame is the difference
   * between sixty renders a second and sixteen — the browser was already going
   * to paint once per frame either way.
   */
  function onPointerMove(e) {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch.current && !drag.current) return;
    moved.current = true;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.current.gap > 0) {
          zoomTo(pinch.current.scale * (gap / pinch.current.gap),
            (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
      } else if (drag.current) {
        const p = [...touches.current.values()][0];
        if (!p) return;
        const x = p.x - drag.current.x;
        const y = p.y - drag.current.y;
        setView((v) => ({ scale: v.scale, ...clamp(x, y, v.scale) }));
      }
    });
  }

  function onPointerUp(e) {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (!touches.current.size) {
      drag.current = null;
      if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    }
  }

  if (!mounted) return null;

  /*
   * Two kinds of picture end up in here.
   *
   * A place photograph is a Google reference and has to be fetched at a size;
   * a picture someone attached is already a data URL in this tab's memory and
   * has no size to ask for. Both are just a src by the time they reach an
   * <img>, so the difference stops here.
   */
  const src = (p, w) => {
    if (p && p.url) return p.url;
    if (p && p.raw) return sized(p, w);
    return `/api/places/photo?ref=${encodeURIComponent((p && p.ref) || '')}&w=${w}`;
  };

  return createPortal((
    <div className={`lightbox${zoomed ? ' is-zoomed' : ''}`}
      role="dialog" aria-modal="true" aria-label={alt || 'Photo'}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget && !moved.current) onClose(); }}>

      <div className="lb-tools">
        <button type="button" data-tip="Zoom out  −" aria-label="Zoom out" disabled={!zoomed}
          onClick={() => zoomTo(view.scale / STEP)}><ZoomOut size={17} /></button>
        <span className="lb-pct" aria-live="polite">{Math.round(view.scale * 100)}%</span>
        <button type="button" data-tip="Zoom in  +" aria-label="Zoom in" disabled={view.scale >= MAX}
          onClick={() => zoomTo(view.scale * STEP)}><ZoomIn size={17} /></button>
        <button type="button" data-tip="Close  Esc" aria-label="Close photo"
          onClick={onClose}><X size={18} /></button>
      </div>

      {many ? (
        <button className="lb-step lb-prev" type="button" data-tip="Previous  ←" aria-label="Previous photo"
          onClick={() => step(-1)}><ChevronLeft size={22} /></button>
      ) : null}

      <figure className="lb-frame" ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => zoomTo(zoomed ? 1 : 2.5, e.clientX, e.clientY)}>
        {/*
          * Two copies of the same picture, one on top of the other.
          *
          * The small one is already in the cache — the strip drew it — so it
          * paints in the same frame as the click and the viewer never shows
          * the previous photo, or a blank, while the big one is on its way.
          * The big one fades in over it once it has decoded.
          *
          * Keyed on the reference so React builds a new element per photo: a
          * reused <img> keeps the old picture on screen until the new source
          * decodes, which is most of what "slow to switch" was.
          */}
        {loaded ? null : <Loader2 size={22} className="spin lb-wait" aria-label="Loading" />}
        <div className="lb-stack">
          <img className="lb-thumb" key={`t-${idOf(shot)}`} aria-hidden="true"
            src={src(shot, THUMB)} alt="" draggable={false}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
          <img ref={imgRef} className={`lb-full${loaded ? ' is-on' : ''}`}
            key={idOf(shot)}
            src={src(shot, wide)} alt={alt} draggable={false}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
        </div>
        {/*
          * A place photograph on Google belongs to whoever went and stood
          * there. Naming them is the courtesy, and it is also the only caption
          * these pictures have — so it takes the line, and the how-to-zoom
          * hint steps aside for it.
          */}
        <figcaption className="lb-count">
          {many ? `${index + 1} of ${photos.length}` : ''}
          {many && shot.author ? ' · ' : ''}
          {shot.author ? (
            <>
              Photo by
              {' '}
              {shot.authorUri
                ? <a href={shot.authorUri} target="_blank" rel="noreferrer">{shot.author}</a>
                : shot.author}
              {shot.provider ? (
                <>
                  {' '}on{' '}
                  <a href={shot.pageUrl || sourceOf(shot).url}
                    target="_blank" rel="noreferrer">{sourceOf(shot).name}</a>
                  {shot.licence ? ` (${shot.licence})` : ''}
                </>
              ) : null}
            </>
          ) : (
            <>{many ? ' · ' : ''}{zoomed ? 'Drag to move' : 'Double-click to zoom'}</>
          )}
        </figcaption>
      </figure>

      {many ? (
        <button className="lb-step lb-next" type="button" data-tip="Next  →" aria-label="Next photo"
          onClick={() => step(1)}><ChevronRight size={22} /></button>
      ) : null}
    </div>
  ), document.body);
}
