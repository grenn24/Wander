'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Loader2, Search, X } from 'lucide-react';
import GoogleMap from '@/components/GoogleMap';
import Lightbox from '@/components/Lightbox';
import AskLegend from '@/components/AskLegend';
import PlacePanel, { FoundRow, PlaceRoute } from '@/components/PlacePanel';
import { categoryOf } from '@/components/askLookup';
import { useModalChrome } from '@/lib/useModal';
import { NEARBY_KINDS, nearby, placeDetails, searchPlaces } from '@/lib/geo';
import { categoryIcon } from '@/lib/icons';
import x from './MapExplorer.module.css';

/**
 * A map to look around on, at the size of the window: the places an answer
 * named, and everything else on the map besides.
 *
 * Beside the map (under it on a phone) is one column that works the way a
 * map app's does: the list of places, or one place in full — its photos,
 * hours, reviews and contacts — with the way there drawn on this map, what
 * else is around it, and Street View. Any of Google's own places on the map
 * opens the same way when clicked, and the search box finds anything else.
 * Back steps out one level at a time, and so does Escape.
 *
 * A place ("target"): { id, kind: 'stop' | 'place', name, lat, lng, place_id,
 * photo_ref, photos, category, address, type_label, stop }. Its id is its
 * marker's: a stop's activity id, or the id in `places`.
 */
export default function MapExplorer({
  title, stops, places, rows, start, days, activities, onOpenStop, onAddPlace, onClose,
}) {
  const [trail, setTrail] = useState(() => (start ? [{ type: 'list' }, { type: 'place', place: start }] : [{ type: 'list' }]));
  const view = trail[trail.length - 1];
  const current = view.place || null;
  const [facts, setFacts] = useState({}); // place_id -> details | 'failed'
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null); // search results, null until searched
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState({}); // `${id}:${kind}` -> results | 'busy' | 'failed'
  const [route, setRoute] = useState(null); // { path, from, fromName, here }
  const [street, setStreet] = useState(null); // { lat, lng } Street View is looking at
  const [streetState, setStreetState] = useState('off'); // off | asking | open | none
  const [fit, setFit] = useState(null);
  const [shots, setShots] = useState(null);
  const viewport = useRef(null);
  const side = useRef(null);

  const leaveStreet = () => { setStreet(null); setStreetState('off'); };

  // Clicking things on the map while a place is open swaps it, as a map app
  // does; anything opened from a list stacks, so Back returns to the list.
  const open = useCallback((place) => {
    leaveStreet();
    setTrail((t) => {
      const top = t[t.length - 1];
      return top.type === 'place' ? [...t.slice(0, -1), { type: 'place', place }] : [...t, { type: 'place', place }];
    });
  }, []);
  const push = (v) => { leaveStreet(); setTrail((t) => [...t, v]); };
  const back = () => { leaveStreet(); setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t)); };

  useModalChrome({
    onEscape: () => {
      if (street) { leaveStreet(); return; }
      if (trail.length > 1) { back(); return; }
      onClose();
    },
  });

  // A new view starts at its top.
  useEffect(() => { if (side.current) side.current.scrollTop = 0; }, [view]);

  // The place's details, once, when it is opened.
  const pid = current && current.place_id;
  useEffect(() => {
    if (!pid || facts[pid]) return;
    placeDetails(pid)
      .then((d) => setFacts((f) => ({ ...f, [pid]: d || 'failed' })))
      .catch(() => setFacts((f) => ({ ...f, [pid]: 'failed' })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);
  const d = pid && facts[pid] && facts[pid] !== 'failed' ? facts[pid] : null;

  // A place clicked on the map knows nothing but its id until the details come.
  const shown = useMemo(() => current && ({
    ...current,
    name: current.name || (d && d.name) || '',
    lat: current.lat != null ? current.lat : d && d.lat,
    lng: current.lng != null ? current.lng : d && d.lng,
    category: current.category || (d ? categoryOf(d.primary_type) : 'other'),
    address: current.address || (d && d.address) || '',
    type_label: current.type_label || (d && d.type_label) || '',
  }), [current, d]);

  /* ------------------------------------------------------ results -- */

  const nearView = view.type === 'nearby' ? view : null;
  const nearKey = nearView ? `${nearView.place.id}:${nearView.kind}` : '';
  useEffect(() => {
    if (!nearKey || found[nearKey]) return;
    setFound((f) => ({ ...f, [nearKey]: 'busy' }));
    const { place, kind } = nearView;
    nearby(Number(place.lat), Number(place.lng), kind, 800)
      .then((list) => {
        // Not the place itself, which a search around it finds first.
        const out = (list || []).filter((p) => !place.place_id || p.place_id !== place.place_id).map((p) => ({
          id: p.id, kind: 'place', name: p.name, lat: p.lat, lng: p.lng, place_id: p.place_id,
          photo_ref: p.photo_ref, category: p.category, address: p.location, type_label: p.detail,
          rating: p.rating, km: p.km,
        }));
        setFound((f) => ({ ...f, [nearKey]: out }));
        if (out.length) setFit({ key: nearKey, points: [place, ...out] });
      })
      .catch(() => setFound((f) => ({ ...f, [nearKey]: 'failed' })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearKey]);

  async function runSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const at = viewport.current;
      const list = await searchPlaces(q, at ? { lat: at.lat, lng: at.lng, radius: at.radius } : null);
      const out = (list || []).map((p) => ({
        id: `q-${p.place_id}`, kind: 'place', name: p.name || p.label, lat: p.lat, lng: p.lng,
        place_id: p.place_id, photo_ref: p.photo_ref, photos: p.photos,
        category: categoryOf(p.primary_type), address: p.label, type_label: p.type_label,
      }));
      setHits(out);
      setTrail([{ type: 'list' }]);
      if (out.length) setFit({ key: `q:${q}:${Date.now()}`, points: out });
    } catch {
      setHits([]);
    }
    setSearching(false);
  }
  const clearSearch = () => { setHits(null); setQuery(''); };

  // The results the map shows: the nearest nearby search under this view, or the text search.
  const layer = useMemo(() => {
    for (let i = trail.length - 1; i >= 0; i -= 1) {
      const v = trail[i];
      if (v.type === 'nearby') {
        const r = found[`${v.place.id}:${v.kind}`];
        return Array.isArray(r) ? r : [];
      }
    }
    return hits || [];
  }, [trail, found, hits]);

  /* ---------------------------------------------------------- map -- */

  const targets = useMemo(() => rows.map((r) => r.target).filter(Boolean), [rows]);
  const byId = useMemo(() => {
    const m = new Map();
    [...targets, ...layer].forEach((t) => m.set(t.id, t));
    if (shown) m.set(shown.id, shown);
    return m;
  }, [targets, layer, shown]);

  const mapPlaces = useMemo(() => {
    const list = [...places];
    const ids = new Set(list.map((p) => p.id));
    const stopIds = new Set(stops.map((a) => a.id));
    const add = (p) => {
      if (!p || p.lat == null || p.lng == null || ids.has(p.id) || stopIds.has(p.id)) return;
      ids.add(p.id);
      list.push({
        ...p, lat: Number(p.lat), lng: Number(p.lng), name: p.name, category: p.category || 'other',
        detail: p.type_label, location: p.address,
      });
    };
    layer.forEach(add);
    if (shown && shown.kind === 'place') add(shown);
    // Where the way starts, when that is a stop this map does not show.
    if (route && route.from && !route.here && !stops.some((a) => a.lat === route.from.lat && a.lng === route.from.lng)) {
      add({ id: 'route-from', name: route.fromName, ...route.from, category: 'other' });
    }
    return list;
  }, [places, stops, layer, shown, route]);

  function poi({ placeId, lat, lng }) {
    const known = [...targets, ...layer].find((t) => t.place_id === placeId);
    open(known || { id: `poi-${placeId}`, kind: 'place', name: '', lat, lng, place_id: placeId });
  }

  function toggleStreet() {
    if (street) { leaveStreet(); return; }
    setStreetState('asking');
    setStreet({ lat: Number(shown.lat), lng: Number(shown.lng) });
  }

  function add() {
    const photo = shown.photo_ref || (d && d.photos && d.photos[0] && d.photos[0].ref) || null;
    onClose();
    onAddPlace({
      name: shown.name, location: shown.address || shown.name, lat: Number(shown.lat), lng: Number(shown.lng),
      category: shown.category || 'sightseeing', photo_ref: photo, place_id: shown.place_id || null,
    });
  }

  const inTrip = shown && shown.kind === 'place' && shown.place_id
    ? (activities || []).find((a) => a.place_id === shown.place_id) || null : null;

  // What Back goes back to, said on the button.
  const under = trail[trail.length - 2];
  const backLabel = !under ? '' : under.type === 'list' ? (hits ? 'Results' : 'All places')
    : under.type === 'nearby' ? `Nearby ${(NEARBY_KINDS.find((k) => k.id === under.kind) || {}).label || ''}`.trim()
      : (under.place && under.place.name) || 'Back';

  /* ------------------------------------------------------- column -- */

  let column;
  if (view.type === 'place') {
    column = (
      <PlacePanel place={shown} details={d} failed={pid && facts[pid] === 'failed'} days={days} inTrip={inTrip}
        onBack={trail.length > 1 ? back : null} backLabel={backLabel}
        onDirections={() => push({ type: 'route', place: shown })}
        onNearby={() => push({ type: 'nearby', place: shown, kind: NEARBY_KINDS[0].id })}
        onStreetView={toggleStreet} street={streetState}
        onAdd={add}
        onOpenStop={(a) => { onClose(); onOpenStop(a); }}
        onPhotos={(photos, index, name) => setShots({ photos, index, title: name })} />
    );
  } else if (view.type === 'route') {
    column = (
      <PlaceRoute key={view.place.id} place={view.place} activities={activities} days={days}
        onRoute={setRoute} onBack={back} />
    );
  } else if (view.type === 'nearby') {
    const got = found[nearKey];
    column = (
      <section className={x.panel} aria-label={`Near ${view.place.name}`}>
        <button type="button" className={`btn ghost sm ${x.back}`} onClick={back}>
          <ArrowLeft size={15} aria-hidden="true" /> {view.place.name}
        </button>
        <div className={x.head}>
          <h3>Nearby</h3>
          <div className="small muted">Within a short walk of {view.place.name}</div>
        </div>
        <div className={`chiprow ${x.kinds}`} role="group" aria-label="What to look for">
          {NEARBY_KINDS.map((k) => {
            const Icon = categoryIcon(k.category);
            return (
              <button key={k.id} type="button" className="btn sm" aria-pressed={view.kind === k.id}
                onClick={() => setTrail((t) => [...t.slice(0, -1), { ...view, kind: k.id }])}>
                <Icon size={14} aria-hidden="true" /> {k.label}
              </button>
            );
          })}
        </div>
        {got === 'busy' || !got ? (
          <p className="small muted"><Loader2 size={14} className="spin" aria-hidden="true" /> Looking around</p>
        ) : got === 'failed' ? (
          <p className="small muted">Could not look around just now.</p>
        ) : !got.length ? (
          <p className="small muted">Nothing of that kind close by.</p>
        ) : (
          <div className={x.foundList}>{got.map((p) => <FoundRow key={p.id} place={p} onOpen={open} />)}</div>
        )}
      </section>
    );
  } else {
    column = (
      <div className={x.list}>
        <form className={`mapfind ${x.search}`} onSubmit={runSearch} role="search">
          <Search size={15} className="mapfind-ico" aria-hidden="true" />
          <input className="mapfind-in" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the map" aria-label="Search for places on the map" />
          {searching ? <Loader2 size={15} className="spin mapfind-busy" aria-label="Searching" /> : null}
        </form>
        {hits ? (
          <section aria-label="Search results">
            <div className={x.listHead}>
              <span className="small muted">{hits.length ? `${hits.length} found` : 'Nothing found'}</span>
              <button type="button" className="btn ghost sm" onClick={clearSearch}><X size={14} /> Clear</button>
            </div>
            <div className={x.foundList}>{hits.map((p) => <FoundRow key={p.id} place={p} onOpen={open} />)}</div>
          </section>
        ) : (
          <>
            <AskLegend rows={rows} onPick={(r) => open(r.target)} />
            <p className={`tiny dim ${x.hint}`}>Click anything on the map to see it here.</p>
          </>
        )}
      </div>
    );
  }

  const shownId = shown ? shown.id : null;
  return createPortal(
    <div className={`amap-expanded-backdrop ${x.full}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="amap-expanded-shell" role="dialog" aria-modal="true" aria-labelledby="mapx-title">
        <header className="amap-expanded-head">
          <div>
            <span className="label">Map</span>
            <h3 id="mapx-title">{title || 'Places in this answer'}</h3>
          </div>
          <button className="btn ghost" type="button" onClick={onClose} autoFocus>
            <X size={15} /> Close
          </button>
        </header>
        <div className={x.body} data-view={view.type}>
          <div className={x.map}>
            <GoogleMap
              fitPlaces
              showAppearance={streetState !== 'open'}
              stops={stops}
              places={mapPlaces}
              focused={shown && shown.kind === 'stop' ? shownId : null}
              focusedPlace={shown && shown.kind === 'place' ? shownId : null}
              stopColour={(a) => a._colour}
              cards={false}
              onFocus={(id) => { const t = byId.get(id); if (t) open(t); }}
              onPlaceFocus={(id) => { const t = byId.get(id); if (t) open(t); }}
              onPoiClick={poi}
              path={view.type === 'route' && route ? route.path : null}
              here={view.type === 'route' && route ? route.here : null}
              streetView={street}
              onStreetView={(st) => {
                if (st === 'open') setStreetState('open');
                else if (st === 'none') { setStreet(null); setStreetState('none'); } else leaveStreet();
              }}
              fitTo={fit}
              onViewport={(v) => { viewport.current = v; }}
              gestures="greedy"
            />
          </div>
          <div className={x.side} ref={side}>{column}</div>
        </div>
      </section>
      {shots ? (
        <Lightbox photos={shots.photos} index={shots.index} alt={shots.title}
          onIndex={(i) => setShots((v) => (v ? { ...v, index: i } : v))}
          onClose={() => setShots(null)} />
      ) : null}
    </div>,
    document.body,
  );
}
