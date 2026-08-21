'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Brings a block in as it reaches the viewport.
 *
 * Deliberately one-way: things settle on arrival and stay settled. Content
 * that re-animates every time it scrolls back past is a page that will not sit
 * still, and this one already has a moving background to carry the life.
 *
 * This checks positions on scroll rather than using IntersectionObserver, and
 * that is the whole point rather than an oversight. An observer only fires when
 * the intersection *changes*, so a jump that skips an element entirely — the
 * "Features" and "How it works" links in the nav do exactly this, as does End —
 * produces no callback at all, and everything jumped over stays at opacity 0
 * permanently. Comparing against the fold catches those, because an element
 * that is now above the viewport is simply an element that has been passed.
 *
 * One listener serves every Reveal on the page and unhooks itself once the
 * last one has arrived.
 */

const waiting = new Set();
let listening = false;
let queued = false;

function sweep() {
  queued = false;
  const line = window.innerHeight * 0.92;
  waiting.forEach((r) => {
    if (!r.el || !r.el.isConnected) { waiting.delete(r); return; }
    if (r.el.getBoundingClientRect().top < line) {
      r.show();
      waiting.delete(r);
    }
  });
  if (!waiting.size) stop();
}

function onScroll() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(sweep);
}

function start() {
  if (listening) return;
  listening = true;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
}

function stop() {
  if (!listening) return;
  listening = false;
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onScroll);
}

export default function Reveal({
  children, delay = 0, as: Tag = 'div', from = 'up', className = '', ...rest
}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return undefined;
    }

    const entry = { el, show: () => setShown(true) };
    waiting.add(entry);
    start();

    // The first check waits a frame so that anything already on screen still
    // gets its transition — checking synchronously would land before the first
    // paint, and it would simply appear already finished.
    const raf = requestAnimationFrame(sweep);

    return () => {
      waiting.delete(entry);
      cancelAnimationFrame(raf);
      if (!waiting.size) stop();
    };
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal reveal-${from}${className ? ` ${className}` : ''}`}
      data-state={shown ? 'in' : 'out'}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
