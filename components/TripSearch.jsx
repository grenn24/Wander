'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { Search, X, Loader2, Plus, CornerDownLeft } from 'lucide-react';
import { useTrip } from '@/components/TripProvider';
import { useApp } from '@/components/AppProvider';
import { categoryOf, fmtDayTiny, fmtTime, shortPlace } from '@/lib/util';
import { categoryIcon } from '@/lib/icons';

/**
 * Find something in the trip — or make it, if it is not there yet.
 *
 * Two halves that answer the same sentence. Matching runs locally on every
 * keystroke: it is a few dozen rows, so it costs nothing, works with no
 * network, and never makes anyone wait to be told what they can already see.
 * Only when nothing matches does the model get involved, and only when asked —
 * "onsen in Hakone" that finds nothing is usually a plan, not a typo, and the
 * useful answer is to offer to add it rather than to shrug.
 *
 * One layout at both sizes. A search that returns a list wants the whole
 * screen on a phone and reads perfectly well centred on a desktop, so there is
 * no second design to keep in step.
 */

/** Everything about an activity that someone might reasonably type. */
function haystack(a) {
  return [a.title, a.location, a.notes, a.booking_ref, categoryOf(a.category).label]
    .filter(Boolean).join(' ').toLowerCase();
}

export default function TripSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const { pushToast, fail } = useApp();
  const {
    tripId, trip, days, activities, addActivities, requestFocus,
  } = useTrip();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [ready, setReady] = useState(false);
  const inputRef = useRef(null);

  // Portals need a DOM to aim at, so nothing escapes during SSR.
  useEffect(() => { setReady(true); }, []);

  const close = useCallback(() => { setOpen(false); setQ(''); setActive(0); }, []);

  // "/" is the web's search key, and Escape closes. Neither fires while
  // someone is typing into something else.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)
        || (document.activeElement && document.activeElement.isContentEditable);
      if (e.key === '/' && !typing && !open) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
      } else if (e.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    // Every word must appear somewhere, so "ramen shibuya" narrows rather than
    // widens the way a single-string match would.
    const words = term.split(/\s+/);
    return activities
      .filter((a) => { const h = haystack(a); return words.every((w) => h.includes(w)); })
      .sort((a, b) => (a.day === b.day
        ? String(a.start_time || '').localeCompare(String(b.start_time || ''))
        : String(a.day).localeCompare(String(b.day))))
      .slice(0, 40);
  }, [q, activities]);

  useEffect(() => { setActive(0); }, [q]);

  const itinerary = `/trips/${tripId}/itinerary`;

  /**
   * Go to an activity: the itinerary scrolls to it and opens it.
   *
   * The request goes through the trip rather than the address. An address can
   * only say a thing once — asking for the same activity a second time changed
   * nothing in the URL and so did nothing at all — and taking the parameter
   * back out afterwards meant a navigation, which closed the editor it had
   * just opened.
   */
  function go(a) {
    close();
    requestFocus(a.id);
    if (pathname !== itinerary) router.push(itinerary);
  }

  /** Nothing matched, so offer to make it rather than leave them at a dead end. */
  async function createFromQuery() {
    const text = q.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          destination: trip.destination || trip.name,
          currency: trip.currency,
          dayLabel: 'the trip',
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.activity) {
        pushToast(body.error || 'Could not read that.', { kind: 'error' });
        return;
      }
      const day = body.activity.day && days.includes(body.activity.day)
        ? body.activity.day : days[0];
      const made = await addActivities([{ ...body.activity, day }]);
      const id = Array.isArray(made) && made[0] ? made[0].id : null;
      pushToast(`Added “${body.activity.title}”.`);
      close();
      if (id) requestFocus(id);
      if (pathname !== itinerary) router.push(itinerary);
    } catch (e) {
      fail(e);
    } finally {
      setAdding(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (hits[active]) go(hits[active]);
      else if (q.trim()) createFromQuery();
    }
  }

  if (!trip) return null;

  return (
    <>
      <button className="btn ghost sm icon-btn" type="button" aria-label="Search this trip"
        data-tip="Search this trip  /" onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
        }}>
        <Search size={16} />
      </button>

      {/*
        * Rendered into <body>, not where it sits in the tree.
        *
        * The trigger lives in the top bar, and the top bar sets backdrop-filter
        * — which makes it the containing block for position:fixed descendants.
        * Left in place the overlay was trapped inside a 51px-tall bar, sized to
        * nothing and clipped, while reporting itself as fixed and full-screen.
        */}
      {open && ready ? createPortal((
        <div className="tsearch-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="tsearch card" role="dialog" aria-modal="true" aria-label="Search this trip">
            <div className="tsearch-top">
              <Search size={17} className="tsearch-ico" aria-hidden="true" />
              <input
                ref={inputRef}
                className="tsearch-in"
                value={q}
                placeholder="Search this trip…"
                aria-label="Search this trip"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <button className="btn ghost sm icon-btn" type="button" aria-label="Close"
                onClick={close}><X size={15} /></button>
            </div>

            {!q.trim() ? (
              <p className="tsearch-empty">
                Search by name, place, note or type — “ramen”, “Shibuya”, “transport”.
              </p>
            ) : hits.length ? (
              <>
                <ul className="tsearch-list" role="listbox" aria-label="Matches">
                  {hits.map((a, i) => {
                    const cat = categoryOf(a.category);
                    const Icon = categoryIcon(cat.id);
                    const place = shortPlace(a.location);
                    return (
                      <li key={a.id} role="option" aria-selected={i === active}
                        className={`tsearch-hit${i === active ? ' is-active' : ''}`}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(e) => { e.preventDefault(); go(a); }}>
                        <span className={`catico cat-${cat.id}`} aria-hidden="true"><Icon size={14} /></span>
                        <span className="tsearch-main">
                          <span className="tsearch-title">{a.title}</span>
                          <span className="tiny dim">
                            {fmtDayTiny(a.day)}
                            {a.start_time ? ` · ${fmtTime(a.start_time)}` : ''}
                            {place ? ` · ${place}` : ''}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="tsearch-foot">
                  <CornerDownLeft size={12} /> to open · {hits.length}
                  {hits.length === 1 ? ' match' : ' matches'}
                </p>
              </>
            ) : (
              <div className="tsearch-none">
                <p className="tsearch-empty" style={{ marginBottom: 10 }}>
                  Nothing in this trip matches “{q.trim()}”.
                </p>
                <button className="btn primary" type="button" disabled={adding}
                  onClick={createFromQuery}>
                  {adding ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
                  Add it to the trip
                </button>
                <p className="tiny dim" style={{ margin: '9px 0 0' }}>
                  Written as you would say it — “onsen in Hakone, 4pm” — and it becomes an
                  activity you can edit.
                </p>
              </div>
            )}
          </div>
        </div>
      ), document.body) : null}
    </>
  );
}
