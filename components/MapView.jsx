'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass, MapPinOff, Loader2, Plus, SquarePen, X, Footprints, TrainFront, TriangleAlert,
  Search, Crosshair,
} from 'lucide-react';
import { categoryOf, fmtDayTiny, fmtTime, sortActs } from '@/lib/util';
import { categoryIcon } from '@/lib/icons';
import {
  reverseGeocode, nearby, searchPlaces, haversine, fmtKm, walkMinutes, NEARBY_KINDS,
} from '@/lib/geo';
import GoogleMap, { googleMapsAvailable } from '@/components/GoogleMap';
import PlacePhoto from '@/components/PlacePhoto';


const CAT_VAR = {
  sightseeing: 1, food: 2, transport: 3, lodging: 4, activity: 5, shopping: 6, other: 7,
};

function catColor(id) {
  if (typeof document === 'undefined') return '#2a78d6';
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(`--cat-${CAT_VAR[id] || 7}`).trim();
  return v || '#2a78d6';
}


export default function MapView({
  trip, days, activities, onEdit, onSetCoords, onNewAt,
}) {
  const mapsReady = googleMapsAvailable();
  const [err, setErr] = useState('');
  const [day, setDay] = useState('all');
  const [focused, setFocused] = useState(null);
  const [locating, setLocating] = useState(null); // {done, total}
  const [kind, setKind] = useState(null);
  const [places, setPlaces] = useState([]);
  const [placesBusy, setPlacesBusy] = useState(false);
  const [dropped, setDropped] = useState(null); // {lat,lng,label,name}
  const [view, setView] = useState(null); // {lat,lng,radius} — what the map is showing
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null); // free-text results, null until searched
  const [searching, setSearching] = useState(false);

  const inDay = useCallback(
    (a) => day === 'all' || a.day === day,
    [day],
  );

  /* Every activity with coordinates is a stop. There is no other kind. */
  const stops = useMemo(() => activities
    .filter((a) => a.lat != null && a.lng != null)
    .filter(inDay)
    .slice()
    .sort((a, b) => (a.day === b.day ? sortActs(a, b) : (a.day < b.day ? -1 : 1))),
  [activities, inDay]);

  /* Has a place written down, but we have not worked out where that is yet. */
  const unresolved = useMemo(
    () => activities.filter((a) => (a.location || '').trim() && a.lat == null),
    [activities],
  );

  /* Nothing to go on at all — needs a location before it can be shown. */
  const placeless = useMemo(
    () => activities.filter((a) => !(a.location || '').trim() && a.lat == null),
    [activities],
  );

  /** Consecutive legs within a day, for the route line and the distances. */
  const legs = useMemo(() => {
    const out = {};
    let prev = null;
    stops.forEach((a) => {
      if (prev && prev.day === a.day) {
        out[a.id] = haversine(prev.lat, prev.lng, a.lat, a.lng);
      }
      prev = a;
    });
    return out;
  }, [stops]);

  const totalKm = useMemo(
    () => Object.values(legs).reduce((s, k) => s + k, 0),
    [legs],
  );

  /* ------------------------------------------------- resolve locations --- */
  const resolving = useRef(false);

  /**
   * One request for every outstanding stop, rather than one request per stop.
   * The server picks the provider; with Google they resolve in parallel, so a
   * whole trip lands at once instead of appearing one pin at a time.
   */
  const resolveAll = useCallback(async () => {
    if (resolving.current || !onSetCoords || !mapsReady) return;
    const todo = activities.filter((a) => (a.location || '').trim() && a.lat == null);
    if (!todo.length) return;
    resolving.current = true;
    setLocating({ done: 0, total: todo.length });
    try {
      const res = await fetch('/api/places/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: todo.map((a) => ({ id: a.id, query: a.location })),
          bias: trip.destination || '',
        }),
      });
      if (res.ok) {
        const { results } = await res.json();
        let done = 0;
        await Promise.all((results || []).map(async (r) => {
          done += 1;
          setLocating({ done, total: todo.length });
          if (!r.found) return;
          await onSetCoords(r.id, r.lat, r.lng, r.label, r.place_id, r.photo_ref);
        }));
      } else {
        setErr('Could not look those places up. Try again in a moment.');
      }
    } catch (e) {
      setErr('Something went wrong. Please try again later.');
    }
    setLocating(null);
    resolving.current = false;
  }, [activities, trip, onSetCoords, mapsReady]);

  // Resolve whatever is outstanding when the map opens.
  const kicked = useRef(false);
  useEffect(() => {
    if (kicked.current || !unresolved.length) return;
    kicked.current = true;
    resolveAll();
  }, [unresolved.length, resolveAll]);

  /* ------------------------------------------------------------- nearby --- */
  /*
   * "Nearby" means near what is on screen.
   *
   * It used to mean near a chosen stop, which was a fix for an earlier bug —
   * searching the midpoint of a Tokyo stop and a Kyoto stop landed in open
   * countryside where nothing is nearby. But it left the reader choosing a
   * stop from a list to search somewhere they were already looking at. The
   * map's own centre is both closer to what they meant and impossible to get
   * wrong, and panning is the natural way to say "over there instead".
   */
  const anchor = view;

  useEffect(() => {
    if (!kind || !anchor || !mapsReady) { setPlaces([]); return undefined; }
    let alive = true;
    setPlacesBusy(true);
    nearby(anchor.lat, anchor.lng, kind, anchor.radius)
      .then((list) => { if (alive) setPlaces(list); })
      .catch((e) => { if (alive) { setPlaces([]); setErr(e.message); } })
      .finally(() => { if (alive) setPlacesBusy(false); });
    return () => { alive = false; };
  }, [kind, anchor, mapsReady]);

  /** Free text: whatever they are actually after, biased to the same view. */
  async function runSearch(e) {
    if (e) e.preventDefault();
    const q = query.trim();
    if (!q || !mapsReady) return;
    setSearching(true); setErr(''); setKind(null);
    try {
      const found = await searchPlaces(q, anchor);
      const withDistance = found.map((h, i) => ({
        id: h.place_id || `${h.lat},${h.lng},${i}`,
        name: h.name || h.label,
        detail: h.label,
        lat: h.lat,
        lng: h.lng,
        photo_ref: h.photo_ref,
        km: anchor ? haversine(anchor.lat, anchor.lng, h.lat, h.lng) : null,
      }));
      setHits(withDistance);
      setPlaces(withDistance);
    } catch (e2) {
      setHits([]); setPlaces([]);
      setErr('Something went wrong. Please try again later.');
    }
    setSearching(false);
  }

  function clearFinds() {
    setKind(null); setHits(null); setPlaces([]); setQuery('');
  }

  /* ---------------------------------------------------------------- map --- */

  function focus(a) {
    setFocused(a.id);
    const m = markers.current[a.id];
    if (m && mapRef.current) {
      mapRef.current.flyTo([a.lat, a.lng], Math.max(mapRef.current.getZoom(), 14), { duration: .5 });
      m.openPopup();
    }
  }

  const targetDay = day === 'all' ? (days[0] || null) : day;

  /*
   * Adding from the map opens the editor with what we already know filled in,
   * rather than writing a stop straight to the trip and leaving the reader to
   * go and find it. A point on a map is a starting position, not a plan: the
   * time, the day and what it is actually for are still theirs to say.
   */
  function newAt(seed) {
    if (!onNewAt) return;
    onNewAt({
      day: targetDay || days[0] || null,
      title: seed.title || 'New stop',
      location: seed.location || '',
      lat: seed.lat,
      lng: seed.lng,
      category: seed.category || 'sightseeing',
      photo_ref: seed.photo_ref || null,
      cost: 0,
    });
    setDropped(null);
  }

  function addPlace(pl) {
    const cat = NEARBY_KINDS.find((k) => k.id === pl.kind);
    newAt({
      title: pl.name,
      location: pl.detail ? `${pl.name} · ${pl.detail}` : pl.name,
      lat: pl.lat,
      lng: pl.lng,
      category: cat ? cat.category : 'sightseeing',
      photo_ref: pl.photo_ref,
    });
  }

  const finds = places;
  const showingFinds = !!kind || hits !== null;
  const findsBusy = placesBusy || searching;
  /*
   * Zoomed out to the whole trip, the centre of the view is usually farmland
   * between two cities, and "nearby" honestly means nearby that. Better to say
   * so than to return a list of places an hour's drive apart and look broken.
   *
   * The threshold is three times the 4km the search itself reaches, not the
   * moment the reach is exceeded: a city-wide view is half-covered and returns
   * things 200m away, so warning there would be crying wolf.
   */
  const viewTooWide = !!anchor && anchor.spanKm > 12;

  return (
    <div className="mappage">
      <div className="page-head spread">
        <div>
          <h2>Map</h2>
          <div className="small muted">
            {stops.length} stop{stops.length === 1 ? '' : 's'}
            {totalKm > 0 ? ` · ${fmtKm(totalKm)} between them` : ''}
            {locating ? ` · locating ${locating.done}/${locating.total}…` : ''}
          </div>
        </div>
      </div>

      {days.length > 1 ? (
        <div className="daystrip">
          <button type="button" className={`daychip${day === 'all' ? ' active' : ''}`}
            onClick={() => { setDay('all'); setFocused(null); }}>
            <span className="daychip-n">All</span>
            <span className="daychip-d">{days.length} days</span>
          </button>
          {days.map((d, i) => (
            <button key={d} type="button" className={`daychip${day === d ? ' active' : ''}`}
              onClick={() => { setDay(d); setFocused(null); }}>
              <span className="daychip-n">Day {i + 1}</span>
              <span className="daychip-d">{fmtDayTiny(d)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}

      <div className="maplayout">
        <div className="map-wrap">
          {mapsReady ? (
            <GoogleMap
              stops={stops}
              places={places}
              focused={focused}
              dayColours={catColor}
              onFocus={setFocused}
              onDropPin={async (lat, lng) => {
                setDropped({ lat, lng, label: 'Looking up…', name: '' });
                try {
                  const r = await reverseGeocode(lat, lng);
                  setDropped({ lat, lng, label: r.label, name: r.name });
                } catch (e) {
                  setDropped({ lat, lng, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, name: '' });
                }
              }}
              onViewport={setView}
              onError={(m) => setErr(m)}
            />
          ) : (
            <div className="mapsetup">
              <MapPinOff size={26} aria-hidden="true" />
              <p className="empty-title">The map needs a Google Maps key</p>
              <p className="small muted">
                Set <code>NEXT_PUBLIC_MAPS_JAVASCRIPT_API_KEY</code> to draw the map, and{' '}
                <code>PLACES_API_KEY</code> for locating stops, nearby search and photos.
                Both go in <code>.env.local</code>; restart the server afterwards.
              </p>
              <p className="tiny dim" style={{ marginBottom: 0 }}>
                Each variable is named after the Google Cloud API it belongs to:
                enable <strong>Maps JavaScript API</strong> and <strong>Places API (New)</strong>.
              </p>
            </div>
          )}
        </div>

        <aside className="mapside">
          {dropped ? (
            <div className="card notice mapside-drop">
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <strong className="small">{dropped.name || 'Dropped point'}</strong>
                  <div className="tiny muted" style={{ overflowWrap: 'anywhere' }}>{dropped.label}</div>
                </div>
                <button className="btn ghost sm icon-btn" aria-label="Dismiss"
                  onClick={() => setDropped(null)}><X size={14} /></button>
              </div>
              <button className="btn primary sm" style={{ width: '100%', marginTop: 10 }}
                onClick={() => newAt({
                  title: dropped.name, location: dropped.label,
                  lat: dropped.lat, lng: dropped.lng,
                })}>
                <Plus size={15} /> Add a stop here
              </button>
            </div>
          ) : null}

          <div className="mapside-head">
            <Compass size={15} />
            <span>Explore nearby</span>
            {showingFinds ? (
              <button className="btn ghost sm icon-btn mapside-clear" aria-label="Clear results"
                onClick={clearFinds}><X size={14} /></button>
            ) : null}
          </div>
          {/* Only when it is actually a problem. Explaining that the search
              follows the map is a caption on something you find out by using
              it once; that the view has outrun the search is not. */}
          {viewTooWide ? (
            <p className="tiny dim mapside-where">
              <Crosshair size={12} aria-hidden="true" />
              the view is wider than search reaches — zoom into a neighbourhood
            </p>
          ) : null}

          <form className="mapfind" onSubmit={runSearch}>
            <Search size={15} className="mapfind-ico" aria-hidden="true" />
            <input
              className="mapfind-in"
              value={query}
              disabled={!mapsReady}
              placeholder="Search for anything…"
              aria-label="Search for places near the map view"
              onChange={(e) => setQuery(e.target.value)}
            />
            {searching ? <Loader2 size={15} className="spin mapfind-busy" aria-label="Searching" />
              : null}
          </form>

          <div className="chiprow mapkinds">
            {NEARBY_KINDS.map((k) => {
              const KindIcon = categoryIcon(k.category);
              return (
                <button key={k.id} className="btn sm" aria-pressed={kind === k.id}
                  disabled={!mapsReady}
                  onClick={() => {
                    setHits(null); setQuery('');
                    setKind(kind === k.id ? null : k.id);
                  }}>
                  <KindIcon size={14} aria-hidden="true" /> {k.label}
                </button>
              );
            })}
          </div>

          {!mapsReady ? (
            <p className="small muted" style={{ marginTop: 0 }}>
              Nearby search needs the Google keys as well.
            </p>
          ) : showingFinds ? (
            <div className="mapfinds">
              {findsBusy ? (
                <div className="small muted mapside-busy">
                  <Loader2 size={14} className="spin" /> Looking around here…
                </div>
              ) : finds.length === 0 ? (
                <p className="small muted">
                  {viewTooWide
                    ? 'Nothing near the middle of this view. Zoom into a place first.'
                    : 'Nothing like that around here.'}
                </p>
              ) : finds.map((pl) => (
                <div className="nearby" key={pl.id}>
                  <PlacePhoto photoRef={pl.photo_ref} category="other" size={38} alt="" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="nearby-name">{pl.name}</div>
                    <div className="tiny dim">
                      {pl.detail ? `${pl.detail} · ` : ''}
                      {pl.km != null ? `${fmtKm(pl.km)} away` : ''}
                    </div>
                  </div>
                  <button className="btn sm icon-btn" onClick={() => addPlace(pl)}
                    aria-label={`Add ${pl.name}`}><Plus size={14} /></button>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted mapside-hint">
              Search for something, pick a category, or click anywhere on the map to add a stop
              there.
            </p>
          )}

          <div className="mapside-sep" />

          <h3 className="mapside-h">
            {day === 'all' ? 'Every stop, in order' : `Day ${days.indexOf(day) + 1}, in order`}
          </h3>

          {stops.length ? (
            <div className="stoplist">
              {stops.map((a, i) => {
                const cat = categoryOf(a.category);
                const leg = legs[a.id];
                return (
                  <div key={a.id}>
                    {leg != null ? (
                      <div className={`leg${leg > 60 ? ' leg-far' : ''}`}>
                        {leg > 60 ? <TriangleAlert size={12} />
                          : leg > 5 ? <TrainFront size={12} />
                            : <Footprints size={12} />}
                        {fmtKm(leg)}
                        {leg > 60 ? ' — a long way for one day'
                          : leg > 5 ? ' — too far to walk'
                            : ` · ${walkMinutes(leg)} min walk`}
                      </div>
                    ) : null}
                    <div className={`stop${focused === a.id ? ' is-focus' : ''}`}
                      role="button" tabIndex={0}
                      onClick={() => focus(a)}
                      onKeyDown={(e) => { if (e.key === 'Enter') focus(a); }}>
                      <span className="stop-n">{i + 1}</span>
                      <PlacePhoto photoRef={a.photo_ref} category={cat.id} size={38} alt={a.title} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="stop-name">{a.title}</div>
                        <div className="tiny dim">
                          {fmtDayTiny(a.day)}{a.start_time ? ` · ${fmtTime(a.start_time)}` : ''}
                        </div>
                      </div>
                      <button className="btn ghost sm icon-btn" aria-label={`Edit ${a.title}`}
                        onClick={(e) => { e.stopPropagation(); onEdit(a); }}>
                        <SquarePen size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: 0 }}>
              Give an activity a location and it appears here — or click the map to add one.
            </p>
          )}
        </aside>
      </div>

      {placeless.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 15, marginBottom: 6 }}>Without a location</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            These have no place written down yet, so there is nothing to put on the map.
          </p>
          <div className="chiprow">
            {placeless.map((a) => (
              <button key={a.id} className="btn sm" onClick={() => onEdit(a)}>{a.title}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
