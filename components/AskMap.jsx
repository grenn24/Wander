'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, MapPin, MapPinOff, Maximize2, X } from 'lucide-react';
import GoogleMap, { dayColor, googleMapsAvailable } from '@/components/GoogleMap';
import { useTrip } from '@/components/TripProvider';
import { useModalChrome } from '@/lib/useModal';
import { searchPlaces } from '@/lib/geo';
import { categoryIcon } from '@/lib/icons';
import { stopFor } from '@/lib/tripAsk';
import { fmtDayTiny, fmtTime, shortPlace } from '@/lib/util';
import s from './TripAsk.module.css';

const located = (a) => a && a.lat != null && a.lng != null && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng));

// Google's types, read as the app's own categories, for the pin's glyph.
function categoryOf(type) {
  const t = String(type || '');
  if (/restaurant|cafe|bakery|bar|food|meal|coffee|tea|dessert|ramen|sushi/.test(t)) return 'food';
  if (/lodging|hotel|hostel|inn|resort|ryokan/.test(t)) return 'lodging';
  if (/store|shop|mall|market|supermarket/.test(t)) return 'shopping';
  if (/station|airport|transit|bus|subway|train|ferry/.test(t)) return 'transport';
  if (/amusement|zoo|aquarium|spa|stadium|gym|bowling|theater|cinema|casino|park$/.test(t)) return 'activity';
  return 'sightseeing';
}

/*
 * A name, looked up once per browser session. Each search is billed, and the
 * thread itself survives a reload; without this every reload of a long
 * conversation paid for all of its maps again.
 */
const SEEN = 'wander:askplace:';
function lookup(q, near) {
  try {
    const kept = sessionStorage.getItem(SEEN + q);
    if (kept) return Promise.resolve(JSON.parse(kept));
  } catch { /* storage blocked: search */ }
  return searchPlaces(q, near).then((list) => {
    const first = (list || [])[0] || null;
    if (first) {
      try {
        const { name, label, lat, lng, place_id: id, primary_type: type, photo_ref: ref, photos } = first;
        sessionStorage.setItem(SEEN + q, JSON.stringify({ name, label, lat, lng, place_id: id, primary_type: type, photo_ref: ref, photos }));
      } catch { /* full or blocked */ }
    }
    return first;
  });
}

/** The middle of what the trip has located, to keep a name search near it. */
function centreOf(activities) {
  const pts = activities.filter(located);
  if (!pts.length) return null;
  return {
    lat: pts.reduce((n, a) => n + Number(a.lat), 0) / pts.length,
    lng: pts.reduce((n, a) => n + Number(a.lng), 0) / pts.length,
    radius: 30000,
  };
}

/**
 * A map an answer asked for: stops from the trip by their token, other
 * places looked up by name.
 *
 * Nothing is drawn or looked up until it is scrolled to. Each map is a billed
 * load and each name a billed search, and a long conversation can hold
 * several maps the reader never scrolls back to.
 */
export default function AskMap({ spec, trip, days, activities, onOpenStop, onAddPlace }) {
  const box = useRef(null);
  const [seen, setSeen] = useState(false);
  const [found, setFound] = useState(null); // { [index]: place | null }
  const [failed, setFailed] = useState('');
  const [full, setFull] = useState(false);
  const { setActivityCoords } = useTrip();
  const [placing, setPlacing] = useState(false);
  const placed = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  // The places the answer named, looked up once each.
  const names = useMemo(() => spec.places.map((p, i) => (p.name ? { i, q: [p.name, p.near].filter(Boolean).join(', ') } : null)).filter(Boolean), [spec]);
  useEffect(() => {
    if (!seen || found) return undefined;
    let dead = false;
    const near = centreOf(activities);
    Promise.all(names.map(({ i, q }) => lookup(q, near)
      .then((hit) => [i, hit])
      .catch(() => [i, null])))
      .then((pairs) => { if (!dead) setFound(Object.fromEntries(pairs)); });
    return () => { dead = true; };
    // Looked up once: the trip changing under an old answer should not search again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, names]);

  /*
   * Stops in the plan that have an address but no position yet (typed in
   * rather than picked from a search): looked up and saved, exactly as
   * opening the Map tab does, so the pin lands here and stays — the
   * itinerary's travel times use it too. A stop with no address at all, like
   * a flight, has nothing to look up and is listed without a pin.
   */
  useEffect(() => {
    if (!seen || placed.current) return;
    const todo = spec.places.map((p) => (p.stop ? stopFor(activities, p.stop) : null))
      .filter((a) => a && !located(a) && String(a.location || '').trim());
    if (!todo.length) return;
    placed.current = true;
    setPlacing(true);
    fetch('/api/places/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: todo.map((a) => ({ id: a.id, query: a.location, title: a.title, category: a.category, day: a.day })),
        bias: (trip && trip.destination) || '',
      }),
    })
      .then((res) => (res.ok ? res.json() : { results: [] }))
      .then(({ results }) => Promise.all((results || []).filter((r) => r.found)
        .map((r) => setActivityCoords(r.id, r.lat, r.lng, r.label, r.place_id, r.photo_ref))))
      .catch(() => {})
      .finally(() => setPlacing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  // Every row of the legend, in the answer's order, whether or not it has a pin.
  const rows = useMemo(() => {
    let n = 0;
    return spec.places.map((p, i) => {
      if (p.stop) {
        const a = stopFor(activities, p.stop);
        if (!a) return null;
        const pinned = located(a);
        if (pinned) n += 1;
        return {
          key: `s${i}`, kind: 'stop', a, label: pinned ? n : null, title: a.title, note: p.note,
          meta: [fmtDayTiny(a.day), a.start_time ? fmtTime(a.start_time) : '', shortPlace(a.location)].filter(Boolean).join(' · '),
          colour: dayColor(Math.max(0, days.indexOf(a.day)), days.length),
        };
      }
      const hit = found ? found[i] : undefined;
      return {
        // The answer's name, not Google's: a search without a language comes
        // back in the local one, and the reader just read it in theirs.
        key: `p${i}`, kind: 'place', place: hit, title: p.name, note: p.note,
        meta: hit ? shortPlace(hit.label) : p.near, category: hit ? categoryOf(hit.primary_type) : '', missing: found && !hit,
      };
    }).filter(Boolean);
  }, [spec, activities, days, found]);

  const stops = useMemo(() => rows.filter((r) => r.kind === 'stop' && r.label)
    .map((r) => ({ ...r.a, lat: Number(r.a.lat), lng: Number(r.a.lng), pinLabel: r.label, _colour: r.colour })), [rows]);
  const places = useMemo(() => rows.filter((r) => r.kind === 'place' && r.place).map((r) => ({
    ...r.place, id: `ask-${r.key}`, name: r.title, category: r.category, detail: r.meta,
    location: r.place.label,
  })), [rows]);

  const canDraw = googleMapsAvailable() && (stops.length + places.length) > 0;
  const waiting = seen && ((names.length > 0 && !found) || placing);
  // Nothing to draw because the plan has no positions for these stops, as
  // opposed to a search that came back empty.
  const unplaced = rows.some((r) => r.kind === 'stop' && !r.label) && !rows.some((r) => r.kind === 'place' && r.place);

  const mapProps = {
    showAppearance: false,
    fitPlaces: true,
    stops,
    places,
    stopColour: (a) => a._colour,
    describeStop: (a) => ({ meta: [fmtDayTiny(a.day), a.start_time ? fmtTime(a.start_time) : '', shortPlace(a.location)].filter(Boolean).join(' · ') }),
    onStopOpen: (a) => { setFull(false); onOpenStop(a); },
    onPlaceAdd: (p) => { setFull(false); onAddPlace(p); },
    onError: setFailed,
  };

  const legend = (
    <ol className={s.legend}>
      {rows.map((r) => {
        // A plain pin until the lookup says what kind of place it is.
        const Icon = r.kind !== 'place' ? null : r.category ? categoryIcon(r.category) : MapPin;
        const open = r.kind === 'stop' ? () => { setFull(false); onOpenStop(r.a); }
          : r.place ? () => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.title)}&query_place_id=${encodeURIComponent(r.place.place_id || '')}`, '_blank', 'noopener')
            : null;
        return (
          <li key={r.key}>
            <button type="button" className={s.legendRow} onClick={open || undefined} disabled={!open}>
              {r.kind === 'stop' ? (
                r.label ? <span className={s.pin} style={{ '--pin': r.colour }}>{r.label}</span>
                  : <span className={s.pinPlace}><MapPinOff size={13} aria-hidden="true" /></span>
              ) : (
                <span className={s.pinPlace}><Icon size={13} aria-hidden="true" /></span>
              )}
              <span className={s.legendText}>
                <span className={s.legendName}>{r.title}</span>
                <span className="small muted">
                  {[r.missing ? 'Not found on the map' : r.meta, r.kind === 'stop' && !r.label ? 'No location' : '', r.note].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );

  return (
    <figure className={s.map} ref={box}>
      {spec.title ? <figcaption className="small muted">{spec.title}</figcaption> : null}
      <div className={`card ${s.mapFrame}`}>
        {!seen || waiting ? (
          <div className={`${s.mapCanvas} ${s.mapWait}`}>
            <Loader2 size={16} className="spin" aria-hidden="true" />
            <span className="small muted">Finding the places</span>
          </div>
        ) : canDraw ? (
          <div className={s.mapCanvas}>
            <GoogleMap {...mapProps} />
            {/* The editor's Expand map pill, without its full-cover hit area:
                this map is live, and a click on it is a click on the map. */}
            <button type="button" className={`amap-expand-hit ${s.expand}`} onClick={() => setFull(true)}
              aria-label="Open the map full size">
              <span><Maximize2 size={14} /> Expand</span>
            </button>
          </div>
        ) : (
          <div className={`${s.mapWait} ${s.mapNote}`}>
            <MapPin size={16} aria-hidden="true" />
            <span className="small muted">
              {!googleMapsAvailable() ? 'The map needs a Google Maps key.'
                : unplaced ? 'These stops have no location yet. Add one from the itinerary.'
                  : 'None of these places could be found on the map.'}
            </span>
          </div>
        )}
        {failed ? <p className="small muted" role="alert">{failed}</p> : null}
        {legend}
      </div>
      {full && canDraw ? createPortal(
        <FullMap title={spec.title} mapProps={mapProps} legend={legend} onClose={() => setFull(false)} />,
        document.body,
      ) : null}
    </figure>
  );
}

/**
 * The same map at the size of the window, with its list beside it (under it
 * on a phone). The trip editor's expanded map, so it opens, closes and holds
 * the page still the way that one does. Portalled to the body: anything with
 * a backdrop filter above it would otherwise become its containing block.
 */
function FullMap({ title, mapProps, legend, onClose }) {
  useModalChrome({ onEscape: onClose });
  return (
    <div className={`amap-expanded-backdrop ${s.full}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="amap-expanded-shell" role="dialog" aria-modal="true" aria-labelledby="askmap-full-title">
        <header className="amap-expanded-head">
          <div>
            <span className="label">Map</span>
            <h3 id="askmap-full-title">{title || 'Places in this answer'}</h3>
          </div>
          <button className="btn ghost" type="button" onClick={onClose} autoFocus>
            <X size={15} /> Close
          </button>
        </header>
        <div className={s.fullBody}>
          <div className={s.fullMap}><GoogleMap {...mapProps} gestures="greedy" /></div>
          <div className={s.fullList}>{legend}</div>
        </div>
      </section>
    </div>
  );
}
