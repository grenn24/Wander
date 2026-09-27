'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass, MapPinOff, Loader2, Plus, SquarePen, X,
  Search, Crosshair, ChevronUp, ChevronDown, Check, List,
} from 'lucide-react';
import { fmtDay, fmtDayTiny, fmtTime, money, shortPlace, sortActs } from '@/lib/util';
import { categoryIcon } from '@/lib/icons';
import {
  reverseGeocode, nearby, searchPlaces, haversine, fmtKm, activityDistance, placeDetails,
  NEARBY_KINDS, decodePath, thinPath,
} from '@/lib/geo';
import GoogleMap, {
  googleMapsAvailable, catColor, dayColor,
} from '@/components/GoogleMap';
import PlacePhoto from '@/components/PlacePhoto';
import Lightbox from '@/components/Lightbox';
import Popover from '@/components/Popover';
import { viewportChanged } from '@/lib/explore';
import TravelArt from '@/components/TravelArt';
import LegLine from '@/components/LegLine';
import useLegs, { useLegChoices } from '@/components/useLegs';
import { useMapPreferences } from '@/components/MapAppearance';
import { inkOn } from '@/components/mapPin';
import useKept from '@/components/useKept';
import m from './MapView.module.css';


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
  /*
   * On a phone the sheet slides up to open and back down to close: it keeps
   * its open shape for the length of the slide down, marked as leaving from
   * the moment it is put away, and the corner controls take its place once it
   * has gone (MapView.module.css).
   */
  const sheet = useKept(sheetOpen ? 'open' : null, 260);
  const [panelView, setPanelView] = useState('explore');
  // The day being shown, on a phone: one button over the map, its days in a list.
  const [dayEl, setDayEl] = useState(null);
  const [dayOpen, setDayOpen] = useState(false);
  const [shots, setShots] = useState(null); // { photos, index, title }
  const viewRef = useRef(null);
  const stageRef = useRef(null);
  /*
   * How far in from each edge of the map the things laid over it reach, for
   * the map to frame stops in what is left: the day chips along the top, and
   * the panel down the right, with the route card beside it while stops are
   * picked — or, on a phone, the sheet along the bottom. Measured when asked,
   * since the panel's size depends on the window.
   */
  const covered = useCallback(() => {
    const stage = stageRef.current;
    const canvas = stage && stage.querySelector('.mapcanvas');
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    const cover = { top: 0, right: 0, bottom: 0, left: 0 };
    const chips = stage.querySelector('.mapdays');
    const top = chips && chips.getBoundingClientRect();
    if (top && top.height) cover.top = Math.max(0, top.bottom - box.top);
    const panel = stage.querySelector('.mappanel');
    const side = panel && panel.getBoundingClientRect();
    if (side && side.width && side.height) {
      /*
       * The sheet along the bottom spans nearly the whole width. Put away, it
       * is two small controls in a bottom corner, which is a bottom edge too,
       * not a strip down the right. Otherwise it is the column down the right.
       */
      if (side.width > box.width * 0.8 || side.height < box.height * 0.3) cover.bottom = Math.max(0, box.bottom - side.top);
      else if (side.left > box.left + box.width / 2) cover.right = Math.max(0, box.right - side.left);
    }
    // Not the card on its way out: the stops are about to have that room back.
    const card = stage.dataset.card === 'leaving' ? null : stage.querySelector('[data-route-card]');
    const beside = card && card.getBoundingClientRect();
    if (beside && beside.width && cover.right) cover.right = Math.max(cover.right, box.right - beside.left);
    return cover;
  }, []);
  const panelScrollRef = useRef(null);

  /*
   * On a phone, a press on the map puts the sheet away: the map is what the
   * press was for. Heard before the map hears it and not stopped, so the same
   * press still pans the map or taps a pin. Not a press on the controls laid
   * over the map (Map appearance, a stop's card), which are not the map.
   */
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const canvas = stageRef.current && stageRef.current.querySelector('.mapcanvas');
    if (!canvas) return undefined;
    const phone = window.matchMedia('(max-width: 1000px)');
    const pressed = (event) => {
      if (!phone.matches) return;
      const path = event.composedPath ? event.composedPath() : [event.target];
      if (path.some((node) => node instanceof Element && node.matches('.map-appearance, .gminfo'))) return;
      setSheetOpen(false);
    };
    canvas.addEventListener('pointerdown', pressed, true);
    return () => canvas.removeEventListener('pointerdown', pressed, true);
  }, [sheetOpen]);

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

  /*
   * The real way from each stop to the next, once Routes are turned on in Map
   * appearance: times for each way in the list, and the way it draws on the map.
   */
  const [mapPrefs] = useMapPreferences();
  const [choices, choose] = useLegChoices(trip && trip.id);
  const hops = useMemo(() => {
    const out = [];
    let prev = null;
    stops.forEach((a) => {
      const km = activityDistance(prev, a);
      if (km != null) {
        out.push({
          key: a.id, hop: `${prev.id}>${a.id}`, day: a.day,
          from: { lat: prev.lat, lng: prev.lng }, to: { lat: a.lat, lng: a.lng }, km,
        });
      }
      prev = a;
    });
    return out;
  }, [stops]);
  const hopOf = useMemo(() => Object.fromEntries(hops.map((h) => [h.key, h.hop])), [hops]);
  const travel = useLegs(hops, mapPrefs.routes, choices);

  /*
   * Picking stops to see the way between them.
   *
   * With Select on, a tap on a stop ticks it instead of opening it, and the
   * map shows only the ticked stops — each keeping its number from the trip —
   * framed together, with the route from each to the next in trip order,
   * whatever days they fall on. The ways follow the Routes setting, or the
   * suggested way for each hop while Routes are off: seeing the routes is the
   * point. Done lets them all go.
   */
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const numberOf = useMemo(() => new Map(stops.map((a, i) => [a.id, i + 1])), [stops]);
  const pickedStops = useMemo(() => stops.filter((a) => picked.has(a.id)), [stops, picked]);
  const pickHops = useMemo(() => pickedStops.slice(1).map((a, i) => {
    const prev = pickedStops[i];
    return {
      key: `pick:${prev.id}>${a.id}`, hop: `${prev.id}>${a.id}`, day: a.day,
      fromId: prev.id, toId: a.id,
      from: { lat: prev.lat, lng: prev.lng }, to: { lat: a.lat, lng: a.lng },
      km: haversine(prev.lat, prev.lng, a.lat, a.lng),
    };
  }), [pickedStops]);
  const showingPicks = picking && pickedStops.length > 0;
  const pickTravel = useLegs(pickHops, showingPicks && pickHops.length
    ? (mapPrefs.routes === 'off' ? 'auto' : mapPrefs.routes) : 'off', choices);
  const mapStops = useMemo(
    () => (showingPicks ? pickedStops.map((a) => ({ ...a, pinLabel: numberOf.get(a.id) })) : stops),
    [showingPicks, pickedStops, stops, numberOf],
  );
  function togglePick(a) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
      return next;
    });
  }
  function setPickingMode(on) {
    setPicking(on);
    setPicked(new Set());
  }

  const dayLabel = day === 'all' ? `All · ${days.length} days`
    : `Day ${days.indexOf(day) + 1} · ${fmtDayTiny(day)}`;
  // On the button itself, the shortest thing that still says which day.
  const dayShort = day === 'all' ? 'All days' : `Day ${days.indexOf(day) + 1}`;

  const linesFor = (list, legsFound) => list.map((h) => {
    const leg = legsFound.byKey[h.key];
    const way = leg && leg.options.find((o) => o.mode === leg.drawn);
    const real = !!(way && !way.estimate && way.polyline);
    return {
      from: h.from, to: h.to, colour: dayColor(days.indexOf(h.day), days.length),
      // Thinned: a drive across a city comes back with hundreds of points a
      // few metres apart, and every one of them is carried in every frame.
      path: real ? thinPath(decodePath(way.polyline), 15) : null, estimate: !real,
    };
  });
  const routeLines = useMemo(() => {
    if (showingPicks) return linesFor(pickHops, pickTravel);
    if (!travel.on) return null;
    return linesFor(hops, travel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingPicks, pickHops, pickTravel, travel, hops, days]);

  const stopGroups = useMemo(() => {
    const groups = new Map();
    stops.forEach((activity, index) => {
      if (!groups.has(activity.day)) {
        groups.set(activity.day, { day: activity.day, stops: [] });
      }
      const group = groups.get(activity.day);
      // Keep the number from the complete visible list so it matches the pin.
      group.stops.push({ activity, number: index + 1 });
    });
    return [...groups.values()];
  }, [stops]);

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
  function openPanel(view = 'explore') {
    setPanelView(view);
    setSheetOpen(true);
    if (panelScrollRef.current) panelScrollRef.current.scrollTop = 0;
  }
  const reveal = () => openPanel('explore');

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
   * The way through the picked stops. On a wide screen it is a card of its
   * own, beside the panel rather than in it, so the list of stops being
   * picked from keeps its room; on a phone, where the panel is the sheet
   * along the bottom and nothing can go beside it, it stays in the sheet.
   * Drawn in both places, and CSS shows the one for the screen.
   */
  const routeCard = (className, floating = false) => (
    <section className={className} data-route-card={floating ? '' : undefined}
      aria-label="The way between the picked stops">
      <div className={m.pickHead}>
        <span>Route through {pickedStops.length} stops</span>
        <button type="button" className="btn ghost sm" onClick={() => setPicked(new Set())}>Clear</button>
      </div>
      {pickHops.map((h) => {
        const fromColour = dayColor(days.indexOf(pickedStops.find((a) => a.id === h.fromId)?.day), days.length);
        const toColour = dayColor(days.indexOf(h.day), days.length);
        return (
          <div key={h.key} className={m.pickHop}>
            <span className={m.pickPair} aria-label={`From stop ${numberOf.get(h.fromId)} to stop ${numberOf.get(h.toId)}`}>
              <i style={{ background: fromColour, color: inkOn(fromColour) }}>{numberOf.get(h.fromId)}</i>
              <span aria-hidden="true">→</span>
              <i style={{ background: toColour, color: inkOn(toColour) }}>{numberOf.get(h.toId)}</i>
            </span>
            <div className={m.pickLeg}>
              <LegLine km={h.km} leg={pickTravel.byKey[h.key]} onChoose={(mode) => choose(h.hop, mode)} />
            </div>
          </div>
        );
      })}
    </section>
  );

  // Kept on screen while it slides away, once the picks no longer make a route.
  const floatCard = useKept(picking && pickHops.length ? routeCard(m.pickFloat, true) : null, 170);

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
    <div ref={stageRef} className={`mapstage ${m.stage}${sheet.value ? ' is-open' : ''}`}
      data-sheet={sheet.leaving ? 'leaving' : undefined} data-card={floatCard.leaving ? 'leaving' : undefined}>
      <div className="mapcanvas">
        {mapsReady ? (
          <GoogleMap
            allow3D
            stops={mapStops}
            places={places}
            focused={focused}
            stopColour={(a) => dayColor(days.indexOf(a.day), days.length)}
            allowRoutes
            routeLines={routeLines}
            covered={covered}
            placeColour={catColor}
            /*
             * Selecting, not opening the drawer. The marker's own card already
             * says what the stop is, so raising the sheet over the map to
             * repeat it takes the view away to show something you can read
             * where you are looking.
             */
            onFocus={(id) => { setFocused(id); setPanelView('stops'); }}
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
            onPlaceFocus={(id) => { setPickedPlace(id); setPanelView('explore'); }}
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

      {/*
        * A phone shows the day as one button beside the other map controls,
        * and its days in a list over the map. The row of chips is a band
        * across the top of a screen that has little enough map on it already;
        * a wide screen has the room and keeps them.
        */}
      {days.length > 1 ? (
        <>
          <button ref={setDayEl} type="button" className={m.dayPick} aria-expanded={dayOpen}
            aria-label={`Showing ${dayLabel}. Choose a day`} onClick={() => setDayOpen((o) => !o)}>
            <i style={{ background: day === 'all' ? 'var(--text-3)' : dayColor(days.indexOf(day), days.length) }} />
            <span>{dayShort}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <Popover anchorEl={dayEl} open={dayOpen} align="start" width={232} onClose={() => setDayOpen(false)}>
            <div className={`act-menu ${m.dayMenu}`} role="group" aria-label="Show one day">
              <button type="button" aria-current={day === 'all' ? 'true' : undefined}
                onClick={() => { setDay('all'); setFocused(null); setDayOpen(false); }}>
                <i style={{ background: 'var(--text-3)' }} />
                All days<span>{days.length}</span>
              </button>
              {days.map((d, i) => (
                <button key={d} type="button" aria-current={day === d ? 'true' : undefined}
                  onClick={() => { setDay(d); setFocused(null); setDayOpen(false); }}>
                  <i style={{ background: dayColor(i, days.length) }} />
                  Day {i + 1}<span>{fmtDayTiny(d)}</span>
                </button>
              ))}
            </div>
          </Popover>
        </>
      ) : null}

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

      {floatCard.value}

      <aside className="mappanel" data-view={panelView} aria-label="Places and stops">
        <div className="mappanel-compact">
          <button type="button" className="map-explore-trigger" onClick={() => openPanel('explore')}>
            <Search size={18} aria-hidden="true" /><span>Explore nearby…</span>
          </button>
          <button type="button" className="map-stops-trigger" onClick={() => openPanel('stops')}
            aria-label={`${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}. Show the list`}>
            <List size={15} aria-hidden="true" />
            {stops.length}
            <ChevronUp size={15} aria-hidden="true" />
          </button>
        </div>
        {/*
          * The handle is the whole top edge, and it says what it will do.
          * Keep collapse discoverable without requiring a swipe gesture.
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

        <div className="mappanel-views" role="group" aria-label="Map panel view">
          <button type="button" aria-pressed={panelView === 'explore'} onClick={() => openPanel('explore')}>Explore</button>
          <button type="button" aria-pressed={panelView === 'stops'} onClick={() => openPanel('stops')}>My stops <span>{stops.length}</span></button>
        </div>

        <div className="mappanel-scroll" ref={panelScrollRef}>
          {dropped ? (
            <div className="card notice mapside-drop mappanel-drop map-explore">
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

        <div className="mappanel-head map-explore">
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
          <div className="map-explore map-explore-results">
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
          ) : <p className="map-explore-hint small muted">Search or choose a category to explore nearby.</p>}

          </div>

          {showingFinds ? <div className="mapside-sep" /> : null}

          <div className="map-stops">
          <div className="mappanel-title">
            <h3 className="mapside-h">
              Your stops
            </h3>
            <span className={m.titleEnd}>
              <span className="tiny dim">
                {picking ? `${pickedStops.length} of ${stops.length} picked`
                  : `${stops.length} stop${stops.length === 1 ? '' : 's'}`}
                {locating ? ` · locating ${locating.done}/${locating.total}…` : ''}
              </span>
              {stops.length > 1 ? (
                <button type="button" className={`btn sm ${m.pickToggle}`} aria-pressed={picking}
                  data-tip={picking ? 'Show every stop again' : 'Pick stops to see the way between them'}
                  onClick={() => setPickingMode(!picking)}>
                  {picking ? 'Done' : 'Select'}
                </button>
              ) : null}
            </span>
          </div>

          {picking ? (
            pickHops.length ? routeCard(m.pickRoute) : (
              <p className={m.pickHint}>
                {pickedStops.length ? 'Pick another stop to see the way between them.'
                  : 'Tap the stops you want, and the map shows just those, with the way between them.'}
              </p>
            )
          ) : null}

          {stops.length ? (
            <div className={m.days}>
              {stopGroups.map((group) => {
                const colour = dayColor(days.indexOf(group.day), days.length);
                const dayId = `map-day-${group.day || 'undated'}`;
                return (
                  <section key={group.day || 'undated'} aria-labelledby={dayId}>
                    <div className={m.dayTitle}>
                      <h4 id={dayId} className={m.dayName}>
                        {days.includes(group.day) ? `Day ${days.indexOf(group.day) + 1}` : 'Other stops'}
                        {group.day ? ` · ${fmtDay(group.day)}` : ''}
                      </h4>
                      <span className={m.daySub}>
                        {group.stops.length} stop{group.stops.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <ol className={m.stops}>
                      {group.stops.map(({ activity: a, number }) => {
                        const leg = legs[a.id];
                        const sub = [a.start_time ? fmtTime(a.start_time) : 'Time not set', shortPlace(a.location)]
                          .filter(Boolean).join(' · ');
                        return (
                          <li key={a.id}>
                            {leg != null ? (
                              <div className={`${m.leg}${leg > 60 ? ` ${m.legFar}` : ''}`}>
                                <LegLine km={leg} leg={travel.on ? travel.byKey[a.id] : null}
                                  onChoose={(mode) => choose(hopOf[a.id], mode)} />
                              </div>
                            ) : null}
                            <div id={`stop-${a.id}`} className={m.stop}
                              aria-current={!picking && focused === a.id ? 'true' : undefined}
                              aria-pressed={picking ? picked.has(a.id) : undefined}
                              data-picked={picking && picked.has(a.id) ? '' : undefined}
                              data-opening={opening === String(a.id) ? '' : undefined}
                              data-tip={picking ? (picked.has(a.id) ? 'Unpick' : 'Pick') : focused === a.id ? 'Open' : 'Show on map'}
                              role="button" tabIndex={0}
                              onClick={() => (picking ? togglePick(a) : focus(a))}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  if (picking) togglePick(a); else focus(a);
                                }
                              }}>
                              <span className={m.num} style={{ background: colour, color: inkOn(colour) }}>{number}</span>
                              <span className={m.text}>
                                <span className={m.name}>{a.title}</span>
                                <span className={m.sub}>{sub}</span>
                              </span>
                              {picking ? (
                                <span className={m.check} aria-hidden="true"><Check size={14} /></span>
                              ) : (
                                <button type="button" className={`btn ghost sm icon-btn ${m.edit}`}
                                  data-tip="Edit" aria-label={`Edit ${a.title}`}
                                  onClick={(e) => { e.stopPropagation(); onEdit(a); }}>
                                  <SquarePen size={14} />
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
              {Object.keys(legs).length ? (
                <p className={m.note}>
                  {travel.on
                    ? `Distances are straight-line. Travel times are Google's; ~ marks an estimate${travel.gaps.length
                      ? `, where Google can't route that way in ${travel.gaps.join(' or ')}` : ''}.`
                    : 'Straight-line distances. Walking times are estimates; actual routes may take longer. Turn on Routes in Map appearance for real travel times.'}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="map-stops-empty">
              <TravelArt kind="places" className="travel-art-places" />
              <p className="map-stops-empty-title">{day === 'all' ? 'No saved places yet' : 'No stops for this day yet'}</p>
              <p className="small muted">Give an activity a location and it appears here — or tap the map to add one.</p>
            </div>
          )}

          </div>
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
