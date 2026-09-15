'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Maximize2, Minimize2 } from 'lucide-react';
import { plainText } from '@/lib/journeyFormat';
import { useModalChrome } from '@/lib/useModal';
import s from './Journeys.module.css';

const KEY = process.env.NEXT_PUBLIC_MAPS_JAVASCRIPT_API_KEY || '';
export const mapsReady = !!KEY && !KEY.startsWith('REPLACE_WITH');

// Fetched only on a screen wide enough to show it: a phone never downloads it.
const JourneyMap = dynamic(() => import('./JourneyMap'), { ssr: false });

/* How far down the screen the reader's eye is taken to be. */
const READ_LINE = 0.42;

/**
 * The map beside the journal, following the reader down it.
 *
 * It watches the journal rather than being told: which section heading has
 * passed the reading line, and how far the reader has got between the first
 * mention of one stop and the next. That stays out of the journal's own
 * render, so scrolling never re-renders a page of text.
 */
export default function JourneyScrollMap({ flowRef, route, sections, places, dropped }) {
  const [wide, setWide] = useState(false);
  const [where, setWhere] = useState({ section: 0, index: -1, t: 0 });
  const [hover, setHover] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const big = useRef(false);
  big.current = expanded;

  // Only a wide screen has a map to expand.
  useEffect(() => { if (!wide) setExpanded(false); }, [wide]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 961px)');
    const read = () => setWide(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);

  useEffect(() => {
    if (!wide) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const root = flowRef.current;
      if (!root) return;
      const line = window.innerHeight * READ_LINE;
      let section = 0;
      root.querySelectorAll('[data-section]').forEach((h) => {
        if (h.getBoundingClientRect().top < line) section = Number(h.dataset.section) || 0;
      });
      const mids = route.map((st) => {
        const el = root.querySelector(`[data-place="${st.id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      let index = -1;
      for (let k = 0; k < mids.length; k += 1) {
        if (mids[k] == null) continue;
        if (mids[k] < line) index = k; else break;
      }
      let t = 0;
      if (index >= 0 && index < route.length - 1 && mids[index + 1] != null) {
        const span = mids[index + 1] - mids[index];
        t = span > 1 ? Math.min(1, Math.max(0, (line - mids[index]) / span)) : 1;
      }
      t = Math.round(t * 40) / 40;
      setWhere((w) => (w.section === section && w.index === index && w.t === t ? w : { section, index, t }));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [wide, flowRef, route]);

  // A place name under the pointer lights up its pin.
  useEffect(() => {
    const root = flowRef.current;
    if (!wide || !root) return undefined;
    const over = (e) => {
      const el = e.target.closest ? e.target.closest('[data-place]') : null;
      setHover(el ? el.dataset.place : null);
    };
    const out = () => setHover(null);
    root.addEventListener('mouseover', over);
    root.addEventListener('mouseleave', out);
    return () => {
      root.removeEventListener('mouseover', over);
      root.removeEventListener('mouseleave', out);
    };
  }, [wide, flowRef]);

  // A pin takes you to where the journal talks about the place, putting an
  // expanded map back first so the page is there to scroll.
  function showInJournal(id) {
    const el = flowRef.current && flowRef.current.querySelector(`[data-place="${id}"]`);
    if (!el) return;
    const wasBig = big.current;
    setExpanded(false);
    setTimeout(() => {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      el.classList.remove(s.flash);
      void el.offsetWidth; // restart the highlight if it is already running
      el.classList.add(s.flash);
      setTimeout(() => el.classList.remove(s.flash), 1900);
    }, wasBig ? 80 : 0);
  }

  const now = sections[where.section];
  /*
   * Expanding lifts this same map over the page rather than opening a second
   * one: nothing reloads, and the route, pins and position carry over. The
   * slot keeps its place in the column, so the bar beneath does not move.
   */
  return (
    <div className={s.mapSlot}>
      {expanded ? <ExpandedChrome onEscape={() => setExpanded(false)} /> : null}
      {expanded ? <div className={s.mapShade} aria-hidden="true" onClick={() => setExpanded(false)} /> : null}
      <div className={`${s.mapBox}${expanded ? ` ${s.mapBig}` : ''}`}
        role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined}
        aria-label={expanded ? 'The route' : undefined}>
        {wide ? (
          <JourneyMap route={route} sections={sections} where={where} dropped={dropped}
            hover={hover} onPin={showInJournal} expanded={expanded} />
        ) : null}
        {now && (now.title || now.kicker) ? (
          <div className={s.mapNow} aria-live="polite">
            {now.kicker ? <span>{now.kicker}</span> : null}
            <strong>{plainText(now.title, places)}</strong>
          </div>
        ) : null}
        {wide ? (
          <button type="button" className={s.mapExpand} aria-expanded={expanded}
            aria-label={expanded ? 'Shrink the map' : 'Expand the map'} onClick={() => setExpanded((e) => !e)}>
            {expanded ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* While the map is expanded, Escape puts it back and the page holds still underneath. */
function ExpandedChrome({ onEscape }) {
  useModalChrome({ onEscape });
  return null;
}
