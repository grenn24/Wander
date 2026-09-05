'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass, MapPinOff, Loader2, Plus, SquarePen, X,
  Search, Crosshair, ChevronUp, ChevronDown,
} from 'lucide-react';
import { categoryOf, fmtDayTiny, fmtTime, money, shortPlace, sortActs } from '@/lib/util';
import { activityIcon, categoryIcon } from '@/lib/icons';
import {
  reverseGeocode, nearby, searchPlaces, haversine, fmtKm, activityDistance, placeDetails,
  NEARBY_KINDS,
} from '@/lib/geo';
import GoogleMap, {
  googleMapsAvailable, catColor, dayColor,
} from '@/components/GoogleMap';
import PlacePhoto from '@/components/PlacePhoto';
import Lightbox from '@/components/Lightbox';
import { viewportChanged } from '@/lib/explore';
import TravelEstimate from '@/components/TravelEstimate';


export default function MapView({
  trip, days, activities, onEdit, onSetCoords, onNewAt, opening = '',
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
  const [pickedPlace, setPickedPlace] = useState(null);
  const [searchedAt, setSearchedAt] = useState(null); // where the results came from
  const [epoch, setEpoch] = useState(0); // bumped to ask again
  /*
   * How much of the phone screen the panel is taking.
   *
   * Collapsed it is a search box and four chips over the map; open it is a
   * list. Two states rather than a draggable sheet, because the only two
   * heights anyone wants are "let me see the map" and "let me read the list",
   * and a gesture that lands anywhere in between is a gesture to get wrong.
   */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shots, setShots] = useState(null); // { photos, index, title }
  const viewRef = useRef(null);
  const panelScrollRef = useRef(null);

  // A newly dropped pin must not open below the list's previous scroll position.
  useEffect(() => {
    if (dropped && panelScrollRef.current) panelScrollRef.current.scrollTop = 0;
  }, [dropped]);

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

  /** Consecutive legs within a day, for the route line and the distances. */
  const legs = useMemo(() => {
    const out = {};
    let prev = null;
    stops.forEach((a) => {
      const km = activityDistance(prev, a);
      if (km != null) out[a.id] = km;
      prev = a;
    });
    return out;
  }, [stops]);

  const stopGroups = useMemo(() => {
    const groups = new Map();
    stops.forEach((activity, index) => {
      if (!groups.has(activity.day)) {
        groups.set(activity.day, { day: activity.day, stops: [], km: 0 });
      }
      const group = groups.get(activity.day);
      // Keep the number from the complete visible list so it matches the pin.
      group.stops.push({ activity, number: index + 1 });
      group.km += legs[activity.id] || 0;
    });
    return [...groups.values()];
  }, [stops, legs]);

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
  viewRef.current = view;

  /*
   * Results are fetched when asked for, not whenever the map moves.
   *
   * Re-searching on every idle meant a Places call for each pan, a list that
   * rearranged itself under the reader's hand, and — because new results
   * rebuild the markers — an info window that closed the moment panning to it
   * finished opening it. Maps that show results while you move them offer to
   * search again instead, and this does the same.
   */
  useEffect(() => {
    if (!kind || !mapsReady) { setPlaces([]); setSearchedAt(null); setPlacesBusy(false); return undefined; }
    const at = viewRef.current;
    if (!at) return undefined; // the map has not settled yet; the kick below retries
    let alive = true;
    setPlacesBusy(true);
    setErr('');
    setPlaces([]);
    nearby(at.lat, at.lng, kind, at.radius, at.bounds)
      .then((list) => { if (alive) setPlaces(list); })
      .catch((e) => { if (alive) { setPlaces([]); setErr(e.message); } })
      .finally(() => {
        if (!alive) return;
        setPlacesBusy(false);
        // Recorded even on failure, so a failed search cannot spin the retry.
        setSearchedAt(at);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, mapsReady, epoch]);

  // A category picked before the map settled still deserves its search.
  useEffect(() => {
    if (kind && view && !searchedAt && !placesBusy) setEpoch((n) => n + 1);
  }, [kind, view, searchedAt, placesBusy]);


  /** Free text: whatever they are actually after, biased to the same view. */
  async function runSearch(e) {
    if (e) e.preventDefault();
    const q = query.trim();
    if (!q || !mapsReady) return;
    setSearching(true); setErr(''); setKind(null); setPickedPlace(null);
    try {
      const found = await searchPlaces(q, anchor);
      const withDistance = found.map((h, i) => ({
        id: h.place_id || `${h.lat},${h.lng},${i}`,
        place_id: h.place_id,
        location: h.label,
        name: h.name || h.label,
        detail: h.label,
        lat: h.lat,
        lng: h.lng,
        photo_ref: h.photo_ref,
        km: anchor ? haversine(anchor.lat, anchor.lng, h.lat, h.lng) : null,
      }));
      setHits(withDistance);
      setPlaces(withDistance);
      setSearchedAt(anchor);
    } catch (e2) {
      setHits([]); setPlaces([]);
      setErr('Something went wrong. Please try again later.');
    }
    setSearching(false);
  }

  function clearFinds() {
    setKind(null); setHits(null); setPlaces([]); setQuery(''); setPickedPlace(null);
  }

  /* Results nobody can see are not results. Asking for some opens the panel. */
  const reveal = () => setSheetOpen(true);

  /* ---------------------------------------------------------------- map --- */

  /*
   * First click points the map at it; a second opens it.
   *
   * A row in this list is the same activity as the card on the itinerary, and
   * there was no way to edit one from here without finding the small pencil at
   * its right edge. Clicking the thing you have already selected is the
   * gesture every file list has trained people to expect.
   */
  function focus(a) {
    if (focused === a.id) { onEdit(a); return; }
    setFocused(a.id);
  }

  /**
   * What a stop's marker says when it is clicked. The map does not know the
   * trip's currency or how this app writes a date, so it asks.
   */
  function describeStop(a) {
    const bits = [fmtDayTiny(a.day)];
    if (a.start_time) bits.push(fmtTime(a.start_time));
    const place = shortPlace(a.location);
    if (place) bits.push(place);
    if (Number(a.cost) > 0) bits.push(money(a.cost, trip.currency));
    return { meta: bits.join(' · ') };
  }

  /**
   * Open the viewer on a place's photographs.
   *
   * The one saved with the activity opens straight away rather than after a
   * round trip; the rest of the place's photos arrive behind it if Google has
   * any, so the viewer fills out while you are already looking at it.
   */
  async function openPhotos(seed) {
    const held = (seed.photos && seed.photos.length ? seed.photos
      // Only a bare reference was saved with the activity, so there is nobody
      // to credit until the details arrive a moment later.
      : seed.photoRef ? [{ ref: seed.photoRef, author: '', authorUri: '' }]
        : []).filter(Boolean);
    if (!held.length) return;
    setShots({ photos: held, index: 0, title: seed.title || '' });
    if (!seed.placeId) return;
    try {
      const d = await placeDetails(seed.placeId);
      // Replaced rather than merged: the same picture comes back under a
      // different name every time, so filtering by equality filters nothing.
      if (d && d.photos && d.photos.length) {
        setShots((s) => (s ? { ...s, photos: d.photos } : s));
      }
    } catch (e) {
      // The photo already on screen is enough; nothing to report.
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
      place_id: seed.place_id || null,
      cost: 0,
    });
    setDropped(null);
  }

  function addPlace(pl) {
    const cat = NEARBY_KINDS.find((k) => k.id === pl.kind);
    newAt({
      title: pl.name,
      location: pl.location || pl.detail || pl.name,
      lat: pl.lat,
      lng: pl.lng,
      category: pl.category || (cat ? cat.category : 'sightseeing'),
      photo_ref: pl.photo_ref,
      place_id: pl.place_id,
    });
  }

  const finds = places;
  const showingFinds = !!kind || hits !== null;
  const findsBusy = placesBusy || searching;

  /** Far enough from where these results came from to be worth asking again. */
  const strayed = !!(showingFinds && searchedAt && view && !findsBusy
    && viewportChanged(searchedAt, view));

  /** Ask again for wherever the map is now, in whichever mode is running. */
  function redo() {
    if (query.trim()) runSearch();
    else if (kind) setEpoch((n) => n + 1);
  }

  /*
   * Clicking a marker selects a row that may be twenty rows down a panel, or
   * behind a collapsed sheet. Selecting something nobody can see is the same
   * as not selecting it, so the list comes to meet the map.
   */
  useEffect(() => {
    if (!focused) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      const row = document.getElementById(`stop-${focused}`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, sheetOpen ? 0 : 320); // wait out the sheet if it is on its way up
    return () => { alive = false; clearTimeout(t); };
  }, [focused, sheetOpen]);

  /*
   * The map is the page.
   *
   * It used to be a rectangle in a column, sharing the screen with a heading
   * that said "Map" over a map, a strip of days and a panel — so on a phone it
   * got a third of the height and on a desktop it stopped well short of the
   * edges. Everything that reads against the map now floats over it instead:
   * the days along the top, everything else in one panel that is a column on
   * the right where there is width for it and a sheet at the bottom where
   * there is not.
   */
  return (
    <div className={`mapstage${sheetOpen ? ' is-open' : ''}`}>
      <div className="mapcanvas">
        {mapsReady ? (
          <GoogleMap
            stops={stops}
            places={places}
            focused={focused}
            stopColour={(a) => dayColor(days.indexOf(a.day), days.length)}
            placeColour={catColor}
            /*
             * Selecting, not opening the drawer. The marker's own card already
             * says what the stop is, so raising the sheet over the map to
             * repeat it takes the view away to show something you can read
             * where you are looking.
             */
            onFocus={setFocused}
            describeStop={describeStop}
            onStopOpen={onEdit}
            onPhoto={openPhotos}
            onDropPin={async (lat, lng) => {
              setDropped({ lat, lng, label: 'Looking up…', name: '' });
              reveal();
              try {
                const r = await reverseGeocode(lat, lng);
                setDropped({ lat, lng, label: r.label, name: r.name });
              } catch (e) {
                setDropped({ lat, lng, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, name: '' });
              }
            }}
            focusedPlace={pickedPlace}
            onPlaceFocus={setPickedPlace}
            onPlaceAdd={addPlace}
            onViewport={setView}
            onError={(m) => setErr(m)}
            /* Full bleed, so there is nothing behind it to scroll and no
               reason to make anyone hold a key to zoom. */
            gestures="greedy"
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

      {days.length > 1 ? (
        <div className="mapdays" role="group" aria-label="Show one day">
          <button type="button" className={`daychip${day === 'all' ? ' active' : ''}`}
            onClick={() => { setDay('all'); setFocused(null); }}>
            <span className="daychip-n">All</span>
            <span className="daychip-d">{days.length} days</span>
          </button>
          {days.map((d, i) => (
            <button key={d} type="button" className={`daychip has-dot${day === d ? ' active' : ''}`}
              style={{ '--dot': dayColor(i, days.length) }}
              onClick={() => { setDay(d); setFocused(null); }}>
              <span className="daychip-n">Day {i + 1}</span>
              <span className="daychip-d">{fmtDayTiny(d)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {err ? <div className="err mapalert">{err}</div> : null}

      {/* Offered rather than done: results that rearrange themselves while
          you are moving the map are worse than results that wait. */}
      {strayed ? (
        <button className="btn sm mapredo" type="button" onClick={() => { redo(); reveal(); }}>
          <Search size={14} /> Search this area
        </button>
      ) : null}

      <aside className="mappanel" aria-label="Places and stops">
        {/*
          * The handle is the whole top edge, and it says what it will do.
          * A phone panel that can be either 150px or most of the screen needs
          * one obvious control, not a gesture you have to discover.
          */}
        <button className="mappanel-grab" type="button" aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((o) => !o)}>
          <span className="mappanel-bar" aria-hidden="true" />
          <span className="mappanel-grab-label">
            {sheetOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            {sheetOpen ? 'Show the map' : `${stops.length} stop${stops.length === 1 ? '' : 's'}`
              + (showingFinds && finds.length ? ` · ${finds.length} found` : '')}
          </span>
        </button>

        <div className="mappanel-scroll" ref={panelScrollRef}>
          {dropped ? (
            <div className="card notice mapside-drop mappanel-drop">
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <strong className="small">{dropped.name || 'Dropped point'}</strong>
                  <div className="tiny muted" style={{ overflowWrap: 'anywhere' }}>{dropped.label}</div>
                </div>
                <button className="btn ghost sm icon-btn" data-tip="Dismiss" aria-label="Dismiss"
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

        <div className="mappanel-head">
          <form className="mapfind" onSubmit={(e) => { runSearch(e); reveal(); }}>
            <Search size={15} className="mapfind-ico" aria-hidden="true" />
            <input
              className="mapfind-in"
              value={query}
              disabled={!mapsReady}
              placeholder="Search this area…"
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
                  data-tip="Search this view"
                  disabled={!mapsReady}
                  onClick={() => {
                    setHits(null); setQuery(''); setPickedPlace(null);
                    setKind(kind === k.id ? null : k.id);
                    reveal();
                  }}>
                  <KindIcon size={14} aria-hidden="true" /> {k.label}
                </button>
              );
            })}
            {showingFinds ? (
              <button className="btn sm ghost" type="button" onClick={clearFinds}>
                <X size={14} /> Clear
              </button>
            ) : null}
          </div>
        </div>

        <div className="mappanel-body">
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
                  {err ? 'Search could not finish. Adjust the map or try again.' : 'No matching places found in this view.'}
                </p>
              ) : finds.map((pl) => (
                <div className={`nearby${pickedPlace === pl.id ? ' is-focus' : ''}`} key={pl.id}
                  role="button" tabIndex={0}
                  onClick={() => setPickedPlace(pl.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setPickedPlace(pl.id); }}>
                  <PlacePhoto photoRef={pl.photo_ref} category={pl.category || 'other'} size={38} alt="" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="nearby-name">{pl.name}</div>
                    <div className="tiny dim">
                      {pl.detail ? `${pl.detail} · ` : ''}
                      {pl.km != null ? `${fmtKm(pl.km)} from map centre` : ''}
                    </div>
                  </div>
                  <button className="btn sm icon-btn"
                    onClick={(e) => { e.stopPropagation(); addPlace(pl); }}
                    data-tip="Add to trip"
                    aria-label={`Add ${pl.name}`}><Plus size={14} /></button>
                </div>
              ))}
            </div>
          ) : null}

          {showingFinds ? <div className="mapside-sep" /> : null}

          <div className="mappanel-title">
            <h3 className="mapside-h">
              Your stops
            </h3>
            <span className="tiny dim">
              {stops.length} stop{stops.length === 1 ? '' : 's'}
              {locating ? ` · locating ${locating.done}/${locating.total}…` : ''}
            </span>
          </div>

          {stops.length ? (
            <div className="stoplist">
              {stopGroups.map((group) => (
                <section className="map-day-group" key={group.day || 'undated'}
                  aria-labelledby={`map-day-${group.day || 'undated'}`}
                  style={{ '--day-colour': dayColor(days.indexOf(group.day), days.length) }}>
                  <div className="map-day-head">
                    <h4 id={`map-day-${group.day || 'undated'}`}>
                      <span className="map-day-dot" aria-hidden="true" />
                      {days.includes(group.day) ? `Day ${days.indexOf(group.day) + 1}` : 'Other stops'}
                      {group.day ? <span className="map-day-date">{fmtDayTiny(group.day)}</span> : null}
                    </h4>
                    <span className="map-day-summary">
                      {group.stops.length} stop{group.stops.length === 1 ? '' : 's'}
                      {group.km > 0 ? ` · ≈ ${fmtKm(group.km)} between stops` : ''}
                    </span>
                  </div>
                  <div className="map-day-stops">
                    {group.stops.map(({ activity: a, number }) => {
                      const cat = categoryOf(a.category);
                      const leg = legs[a.id];
                      return (
                        <div key={a.id}>
                          {leg != null ? (
                            <div className={`leg${leg > 60 ? ' leg-far' : ''}`}>
                              <TravelEstimate km={leg} />
                            </div>
                          ) : null}
                          <div id={`stop-${a.id}`}
                            className={`stop${focused === a.id ? ' is-focus' : ''}`
                              + `${opening === String(a.id) ? ' is-opening' : ''}`}
                            data-tip={focused === a.id ? 'Open' : 'Show on map'}
                            role="button" tabIndex={0}
                            onClick={() => focus(a)}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(a); }
                            }}>
                            <span className="stop-n">{number}</span>
                            <PlacePhoto photoRef={a.photo_ref} category={cat.id} icon={activityIcon(a)} size={38} alt={a.title} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div className="stop-name">{a.title}</div>
                              <div className="map-stop-meta">
                                {a.start_time ? fmtTime(a.start_time) : 'Time not set'}
                              </div>
                            </div>
                            <button className="btn ghost sm icon-btn"
                              data-tip="Edit" aria-label={`Edit ${a.title}`}
                              onClick={(e) => { e.stopPropagation(); onEdit(a); }}>
                              <SquarePen size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              {Object.keys(legs).length ? (
                <p className="map-distance-note">Straight-line distances. Walking times are estimates; actual routes may take longer.</p>
              ) : null}
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: 0 }}>
              Give an activity a location and it appears here — or tap the map to add one.
            </p>
          )}

        </div>
        </div>
      </aside>

      {shots ? (
        <Lightbox photos={shots.photos} index={shots.index} alt={shots.title}
          onIndex={(i) => setShots((v) => (v ? { ...v, index: i } : v))}
          onClose={() => setShots(null)} />
      ) : null}
    </div>
  );
}
