'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import map3dStyles from './PhotorealisticMap.module.css';
import { haversine } from '@/lib/geo';
import { NEARBY_KINDS } from '@/lib/explore';
import { categoryIcon } from '@/lib/icons';
import MapAppearance, { useMapPreferences } from '@/components/MapAppearance';
import { mapColorScheme } from '@/lib/mapPreferences';
import { createMapPopup, placePopupMeta } from '@/lib/mapPopup';

/*
 * Markers are plain DOM, built outside React, but their icons should be the
 * same ones the rest of the app uses — not a second copy of the path data that
 * can drift from the first.
 *
 * So React renders one hidden copy of each category glyph and the marker
 * builder clones the node it needs. No react-dom/server in the bundle, no root
 * per marker to mount and tear down, and changing an icon in lib/icons changes
 * it here too.
 */
const MARKER_CATS = [
  'sightseeing', 'food', 'transport', 'lodging', 'activity', 'shopping', 'other',
];

// Must carry the NEXT_PUBLIC_ prefix: Next only exposes prefixed variables to
// the browser, and a map cannot be drawn without one there.
const KEY = process.env.NEXT_PUBLIC_MAPS_JAVASCRIPT_API_KEY || '';

// Advanced markers refuse to render without a Map ID. Google's demo id works
// out of the box; set NEXT_PUBLIC_MAPS_MAP_ID for a styled one.
const MAP_ID = process.env.NEXT_PUBLIC_MAPS_MAP_ID || 'DEMO_MAP_ID';
const PhotorealisticMap = dynamic(() => import('./PhotorealisticMap'), { ssr: false });

async function load3D() {
  await loadMaps();
  const [maps3d, marker] = await Promise.all([
    window.google.maps.importLibrary('maps3d'),
    window.google.maps.importLibrary('marker'),
  ]);
  return { ...maps3d, PinElement: marker.PinElement };
}

export function googleMapsAvailable() {
  return !!KEY && !KEY.startsWith('REPLACE_WITH');
}

/* Marker colour per category, read from the stylesheet so the map follows the
   theme rather than keeping its own copy of the palette. */
const CAT_VAR = {
  sightseeing: 1, food: 2, transport: 3, lodging: 4, activity: 5, shopping: 6, other: 7,
};

/**
 * Light or dark, to match the page.
 *
 * A full-bleed map in the app's dark theme cannot be a sheet of white paper.
 * Google fixes colorScheme at construction, so this is also what the caller
 * keys the map on: changing theme rebuilds it, which is the price of the
 * option not being settable afterwards.
 */
export function readScheme() {
  if (typeof document === 'undefined') return 'LIGHT';
  const set = document.documentElement.getAttribute('data-theme');
  if (set) return set === 'dark' ? 'DARK' : 'LIGHT';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'DARK' : 'LIGHT';
}

/** The current scheme, and a re-render whenever it changes. */
export function useMapScheme() {
  const [scheme, setScheme] = useState('LIGHT');
  useEffect(() => {
    const read = () => setScheme(readScheme());
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    return () => { mo.disconnect(); mq.removeEventListener('change', read); };
  }, []);
  return scheme;
}

/**
 * A colour per day of the trip, walking the hue circle in order.
 *
 * Colour on a map should answer a question you cannot answer another way. The
 * order of the stops is already written on them as a number, and a number is
 * exact where a hue is a guess — but which day a pin belongs to has nowhere
 * else to live, and on a trip that crosses cities it is the first thing you
 * want to see. So the ramp runs across the trip: consecutive days are
 * neighbouring hues, and you read progress rather than identity.
 *
 * Stops short of a full circle so the last day cannot come back round and
 * impersonate the first.
 */
export function dayColor(index, total) {
  const n = Math.max(1, total || 1);
  const i = index < 0 ? 0 : index;
  return `hsl(${Math.round(((i % n) / n) * 306)} 70% 52%)`;
}

export function catColor(id) {
  if (typeof document === 'undefined') return '#2a78d6';
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(`--cat-${CAT_VAR[id] || 7}`).trim();
  return v || '#2a78d6';
}

let loader = null;

/**
 * Loads the Maps API and hands back the classes it provides.
 *
 * With `loading=async` the script's load event fires once the *bootstrap* has
 * downloaded, not once the API is ready — reading google.maps.Map at that
 * moment yields undefined, which is what "maps.Map is not a constructor" was.
 * The documented fix is a callback plus importLibrary, which is also the only
 * supported way to pull in the marker library.
 */
function loadMaps() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const ready = () => {
      // Three libraries, because the classes are split across them:
      // core has LatLngBounds, maps has Map/InfoWindow/Polyline, marker has
      // AdvancedMarkerElement. Taking any of them from the wrong one yields
      // undefined rather than an error at import time.
      Promise.all([
        window.google.maps.importLibrary('core'),
        window.google.maps.importLibrary('maps'),
        window.google.maps.importLibrary('marker'),
      ]).then(([core, maps, marker]) => resolve({
        LatLngBounds: core.LatLngBounds,
        Map: maps.Map,
        InfoWindow: maps.InfoWindow,
        Polyline: maps.Polyline,
        AdvancedMarkerElement: marker.AdvancedMarkerElement,
      })).catch(reject);
    };

    if (window.google && window.google.maps && window.google.maps.importLibrary) {
      ready();
      return;
    }

    const cbName = '__wanderMapsReady';
    window[cbName] = ready;

    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}`
      + `&loading=async&callback=${cbName}&v=weekly`;
    s.async = true;
    s.addEventListener('error', () => reject(new Error(
      'Google Maps failed to load. Check the key and that Maps JavaScript API is enabled.',
    )));
    document.head.appendChild(s);
  });

  return loader;
}

/**
 * The trip drawn on Google Maps: numbered, category-coloured stops in time
 * order, a dashed route per day, a separate layer for nearby results, and a
 * click anywhere to drop a new stop.
 */
export default function GoogleMap({ showAppearance = true, allow3D = false, ...props }) {
  const appScheme = useMapScheme();
  const [preferences, updatePreferences, preferencesReady] = useMapPreferences();
  const camera = useRef(null);
  const [notice, setNotice] = useState('');
  const scheme = mapColorScheme(preferences.theme, appScheme);
  // Navigation and pin editing retain their street-level gestures. The saved
  // explorer preference must not silently change those specialised maps.
  const type = preferences.type === '3d' && !allow3D ? 'roadmap' : preferences.type;
  function change(patch) { setNotice(''); updatePreferences(patch); }
  function fallback(message) {
    setNotice(message);
    updatePreferences({ type: 'roadmap' });
  }
  // Resolve the saved choice before mounting either billable renderer.
  if (!preferencesReady) return <div className="map-el" aria-label="Loading map" />;
  return (
    <>
      {type === '3d' ? <PhotorealisticMap {...props} camera={camera} loadLibrary={load3D}
        onFallback={fallback} onExit={() => change({ type: 'roadmap' })} />
        : <GoogleMapCanvas {...props} key={scheme} scheme={scheme}
          mapType={type} camera={camera} />}
      {showAppearance ? <MapAppearance preferences={{ ...preferences, type }} allow3D={allow3D} onChange={change} /> : null}
      {notice ? <div className={map3dStyles.notice} role="status">
        <span>{notice}</span><button type="button" className="btn small" onClick={() => setNotice('')}>Dismiss</button>
      </div> : null}
    </>
  );
}

function GoogleMapCanvas({
  scheme, mapType, camera,
  stops, places, focused, focusedPlace,
  // Two different questions, so two different answers: a stop is coloured by
  // the day it belongs to, a suggestion by what kind of place it is.
  stopColour, placeColour = catColor,
  // A route to draw over everything else: the way from one place to another,
  // as opposed to the dashed line that merely joins a day's stops in order.
  path,
  // Where to aim when there are no stops to aim at: a map showing the whole
  // world says less about a place than a map showing the street it is on,
  // even with nothing drawn on top.
  look,
  // Where the reader is standing. A route with only one end on it is half a
  // route — you cannot tell which way along the line you are meant to go.
  here,
  /*
   * Follow mode: the map stays under you rather than you looking for yourself
   * on it, and turns to face the way you are facing. Both are the caller's to
   * switch on, because the caller is the one that can ask the phone.
   *
   * `onFollowBreak` fires the moment the map is dragged. Following is a thing
   * the map is doing *for* you, and a hand on the map is the plainest possible
   * statement that you would rather do it yourself.
   */
  follow = false,
  heading = null,
  onFollowBreak,
  // Told once, when the map knows: whether it is the kind of map that can turn
  // at all. Only a vector Map ID can, and the caller should not offer to point
  // the map at north-east if the answer is always going to be north.
  onRotatable,
  onFocus, onPlaceFocus, onPlaceAdd, onDropPin, onViewport, onError,
  // What a stop should say when its marker is clicked, and what to do about
  // it. The words belong to the page — it knows the trip's currency and how it
  // writes a date — so the map asks rather than deciding.
  describeStop, onStopOpen, onPhoto,
  /*
   * Cooperative by default: a map that swallows the wheel is a trap on a page
   * you are trying to scroll. A map that owns its whole column has no such
   * problem and should just respond, so the caller decides.
   */
  gestures = 'cooperative',
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const libs = useRef(null);
  const stopMarks = useRef([]);
  const placeMarks = useRef([]);
  const lines = useRef([]);
  const route = useRef(null);
  const mine = useRef(null);
  const info = useRef(null);
  // Which marker the open callout belongs to, so a click can tell "dismiss
  // this" from "do something new".
  const shownFor = useRef(null);
  const glyphs = useRef(null);
  /*
   * The fit we still owe the map.
   *
   * fitBounds is a no-op while the map has not measured its container, and the
   * map is built inside a promise — so on a container whose height comes from
   * the layout rather than a fixed value, the first fit can land too early and
   * leave the whole world on screen with every marker stacked in one pixel.
   * Holding the intent and applying it once the element has a size fixes that
   * without guessing at a delay.
   */
  const owedFit = useRef(null);
  // Said once: whether this map is one that can turn.
  const told = useRef(false);
  // Whether the map has ever been aimed. The first fit is ours to make; after
  // that the view belongs to whoever is looking at it.
  const fitted = useRef(false);
  const initialCamera = useRef(camera.current);
  const restoreCamera = useRef(camera.current);
  const [ready, setReady] = useState(false);

  // Latest props, so drawing never closes over a stale render.
  const latest = useRef(null);
  latest.current = {
    stops, places, focused, focusedPlace, stopColour, placeColour, path, here,
    look, follow, onFollowBreak, onRotatable,
    onFocus, onPlaceFocus, onPlaceAdd, onViewport, onDropPin,
    describeStop, onStopOpen, onPhoto,
  };

  useEffect(() => {
    let dead = false;
    loadMaps().then((L) => {
      if (dead || !elRef.current || mapRef.current) return;
      libs.current = L;
      mapRef.current = new L.Map(elRef.current, {
        center: { lat: 35.68, lng: 139.76 },
        zoom: 4,
        mapId: MAP_ID,
        colorScheme: scheme,
        mapTypeId: mapType,
        // Where a double click drops a pin it cannot also zoom: one gesture,
        // two answers, and you get whichever the map felt like.
        disableDoubleClickZoom: !!latest.current.onDropPin,
        // No furniture at all. Scroll, pinch and double-tap are how anyone
        // actually zooms a map, and a pair of grey buttons in the corner of a
        // full-bleed map is a widget sitting on a photograph.
        disableDefaultUI: true,
        zoomControl: false,
        clickableIcons: false,
        gestureHandling: gestures,
      });
      /*
       * A single click puts the open callout away, and otherwise does nothing.
       * Looking at a map is mostly clicking on it — to dismiss something, to
       * take the focus off a field, or by simply missing a marker — and every
       * one of those used to leave a new point behind.
       */
      mapRef.current.addListener('click', () => {
        if (shownFor.current) closeInfo();
      });
      /*
       * Dropping a pin is a decision, so it takes the gesture nobody makes by
       * accident. Through latest, not the closure: this listener is attached
       * once, so a handler captured here would be the first render's for the
       * map's whole life.
       */
      mapRef.current.addListener('dblclick', (e) => {
        const drop = latest.current.onDropPin;
        if (e.latLng && drop) drop(e.latLng.lat(), e.latLng.lng());
      });
      /*
       * A drag is a hand on the map, which outranks anything the map was doing
       * on your behalf. Only a drag: zooming is still a question about where
       * you are, so it leaves following alone.
       */
      mapRef.current.addListener('dragstart', () => {
        const brk = latest.current.onFollowBreak;
        if (latest.current.follow && brk) brk();
      });
      /*
       * "Nearby" means near what you are looking at, so the map has to say
       * where that is. `idle` fires once panning and zooming have settled
       * rather than on every frame of the gesture.
       */
      mapRef.current.addListener('idle', () => {
        applyFit();
        const current = mapRef.current;
        const center = current.getCenter();
        if (center) camera.current = {
          center: { lat: center.lat(), lng: center.lng() },
          zoom: current.getZoom(), heading: current.getHeading() || 0,
        };
        const report = latest.current.onViewport;
        if (!report) return;
        const map = mapRef.current;
        const c = map.getCenter();
        const b = map.getBounds();
        // Centre to corner: the radius that covers what is on screen.
        const corner = b && b.getNorthEast();
        const km = corner ? haversine(c.lat(), c.lng(), corner.lat(), corner.lng()) : 1;
        report({
          lat: c.lat(),
          lng: c.lng(),
          radius: Math.round(Math.min(50000, Math.max(300, km * 1000))),
          bounds: b ? b.toJSON() : null,
          spanKm: km,
        });
      });
      /*
       * Can this map turn? Only a vector one can — a raster map takes a
       * heading, reports it back for a moment, and then draws north-up anyway.
       *
       * Asked on the first idle rather than at construction: until the map has
       * drawn something it answers UNINITIALIZED, and answering the question
       * from the option you just set is how you get a confident wrong answer.
       */
      mapRef.current.addListener('idle', () => {
        const say = latest.current.onRotatable;
        if (!say || told.current) return;
        const map = mapRef.current;
        const R = window.google.maps.RenderingType;
        if (!R || typeof map.getRenderingType !== 'function') { told.current = true; say(false); return; }
        const kind = map.getRenderingType();
        if (kind === R.UNINITIALIZED) return; // ask again next time
        told.current = true;
        say(kind === R.VECTOR && typeof map.setHeading === 'function');
      });
      setReady(true);
    }).catch((e) => { if (!dead && onError) onError(e.message); });
    return () => {
      dead = true;
      if (info.current) info.current.close();
      stopMarks.current.forEach((mark) => { mark.map = null; });
      placeMarks.current.forEach((mark) => { mark.map = null; });
      lines.current.forEach((line) => line.setMap(null));
      if (route.current) route.current.setMap(null);
      if (mine.current) mine.current.map = null;
      if (mapRef.current) window.google.maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready && mapRef.current) {
      told.current = false;
      mapRef.current.setMapTypeId(mapType);
    }
  }, [ready, mapType]);

  useEffect(() => {
    if (ready) drawStops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stops, look]);

  /*
   * Selection is a class, not a redraw.
   *
   * Rebuilding every marker to move a ring also destroys the one the open
   * callout is anchored to — and since clicking a marker is what changes the
   * selection, the card closed in the same frame it opened. Suggestions were
   * given this treatment when the same thing happened to them; stops were left
   * redrawing on every click.
   */
  useEffect(() => {
    if (!ready) return;
    stopMarks.current.forEach((m) => {
      if (m.__el) m.__el.classList.toggle('gmk-focus', m.__id === focused);
    });
  }, [ready, focused, stops]);

  useEffect(() => {
    if (ready) drawPlaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, places]);

  useEffect(() => {
    if (ready) drawPath();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, path]);

  useEffect(() => {
    if (ready) drawHere();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, here]);

  /*
   * Highlighting is a class change, not a redraw. Rebuilding the markers to
   * move a ring would also destroy whichever one the open info window is
   * anchored to, closing it the instant it appeared.
   */
  useEffect(() => {
    if (!ready) return;
    placeMarks.current.forEach((m) => {
      if (m.__el) m.__el.classList.toggle('is-on', m.__id === focusedPlace);
    });
  }, [ready, focusedPlace, places]);

  // Picking a suggestion from the list beside the map is the way through a
  // cluster of them: twenty restaurants on one street are indistinguishable as
  // pins, but the list can say which one you meant.
  useEffect(() => {
    if (!ready || !focusedPlace) return;
    const at = (places || []).find((p) => p.id === focusedPlace);
    if (!at) return;
    mapRef.current.panTo({ lat: at.lat, lng: at.lng });
    if (mapRef.current.getZoom() < 15) mapRef.current.setZoom(15);
    const mark = placeMarks.current.find((m) => m.__id === at.id);
    if (mark) openPlaceInfo(at, mark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusedPlace]);

  // Pan to a stop chosen from the list beside the map.
  useEffect(() => {
    if (!ready || !focused) return;
    const at = stops.find((s) => s.id === focused);
    if (!at) return;
    mapRef.current.panTo({ lat: at.lat, lng: at.lng });
    if (mapRef.current.getZoom() < 14) mapRef.current.setZoom(14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focused]);

  /* Close enough to see which side of the street you are on. */
  const FOLLOW_ZOOM = 17;

  // Switching it on aims the map at you and moves in.
  useEffect(() => {
    if (!ready || !follow) return;
    const map = mapRef.current;
    const at = latest.current.here;
    if (!at) return;
    map.panTo(at);
    if (map.getZoom() < FOLLOW_ZOOM) map.setZoom(FOLLOW_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, follow]);

  // ...and it stays aimed at you as you walk.
  useEffect(() => {
    if (!ready || !follow || !here) return;
    mapRef.current.panTo(here);
  }, [ready, follow, here]);

  /*
   * Turning the map to face the way you are facing, which is the whole point
   * of holding a map up in the street. Only while following, and back to north
   * the moment it stops — a map left at a stale angle is worse than one that
   * never turned.
   *
   * Raster maps ignore setHeading entirely, so this quietly does nothing
   * rather than needing to know which kind of map it was given.
   */
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (typeof map.setHeading !== 'function') return;
    map.setHeading(follow && heading != null ? heading : 0);
  }, [ready, follow, heading]);

  // Restore after the initial marker/route/focus effects too: changing only
  // appearance must not zoom back to a selected stop or the whole route.
  useEffect(() => {
    if (!ready || !restoreCamera.current) return;
    const saved = restoreCamera.current;
    restoreCamera.current = null;
    if (latest.current.follow) return;
    owedFit.current = null;
    initialCamera.current = null;
    mapRef.current.setCenter(saved.center);
    mapRef.current.setZoom(saved.zoom);
    mapRef.current.setHeading(saved.heading);
  }, [ready]);

  /** Apply an owed fit, but only once the map is big enough to have an opinion. */
  function applyFit() {
    const map = mapRef.current;
    const el = elRef.current;
    const want = owedFit.current;
    if (!map || !want || !el || !el.clientHeight || !el.clientWidth) return;
    owedFit.current = null;
    if (initialCamera.current && !latest.current.follow) {
      map.setCenter(initialCamera.current.center);
      map.setZoom(initialCamera.current.zoom);
      map.setHeading(initialCamera.current.heading);
      initialCamera.current = null;
      fitted.current = true;
      return;
    }
    if (want.center) {
      if (!fitted.current) {
        map.setCenter(want.center);
        map.setZoom(14);
      } else {
        // Already aimed once. Move only if the point has left the screen, and
        // never zoom back out — nudging a pin while zoomed in should not throw
        // the view away and start again.
        const b = map.getBounds();
        if (!b || !b.contains(want.center)) map.setCenter(want.center);
      }
      fitted.current = true;
    } else {
      map.fitBounds(want.bounds, 48);
      fitted.current = true;
    }
  }

  /** A pulsing dot for the reader, distinct from anything in the plan. */
  function drawHere() {
    const L = libs.current;
    const map = mapRef.current;
    if (mine.current) { mine.current.map = null; mine.current = null; }
    const at = latest.current.here;
    if (!at) return;
    const el = document.createElement('div');
    el.className = 'gmk-here';
    el.setAttribute('aria-label', 'Where you are');
    mine.current = new L.AdvancedMarkerElement({
      map, position: { lat: at.lat, lng: at.lng }, content: el,
    });
  }

  /** The route itself: solid, heavy, and fitted to on arrival. */
  function drawPath() {
    const L = libs.current;
    const map = mapRef.current;
    if (route.current) { route.current.setMap(null); route.current = null; }
    const pts = latest.current.path;
    if (!pts || pts.length < 2) return;

    route.current = new L.Polyline({
      path: pts,
      strokeColor: catColor('transport'),
      strokeOpacity: 0.95,
      strokeWeight: 5,
      map,
    });

    // Same rule as the stops: a redrawn line is not a reason to pull the view
    // off someone who has asked the map to follow them.
    if (latest.current.follow) return;

    const bounds = new L.LatLngBounds();
    pts.forEach((p) => bounds.extend(p));
    // Both ends in view, even when the drawn line stops short of one of them.
    if (latest.current.here) bounds.extend(latest.current.here);
    (latest.current.stops || []).forEach((a) => bounds.extend({ lat: a.lat, lng: a.lng }));
    owedFit.current = { bounds };
    fitted.current = false; // a new route is a new thing to look at
    applyFit();
  }

  function drawStops() {
    const L = libs.current;
    const map = mapRef.current;
    const {
      stops: list, focused: sel, stopColour: colour, onFocus: focus,
    } = latest.current;

    stopMarks.current.forEach((m) => { m.map = null; });
    stopMarks.current = [];
    lines.current.forEach((l) => l.setMap(null));
    lines.current = [];

    const byDay = {};
    const bounds = new L.LatLngBounds();

    /*
     * Stops that share a spot, fanned out so that neither hides the other.
     *
     * A flight out and a flight back leave from the same terminal; a hotel is
     * the check-in, the check-out and the night in between. All of those
     * geocode to one point, and one pin was simply drawn on top of the others
     * — the map said there was one thing at Changi when there were two, and
     * the one underneath could not be clicked at all.
     *
     * The offset is in screen pixels rather than in degrees, so it holds at
     * every zoom without recomputing, and the marker stays anchored to its
     * real coordinate: what moves is only how it is drawn, with a short
     * leader back to the spot they all share.
     */
    const NEAR_M = 30;
    const spots = [];
    list.forEach((a) => {
      const at = spots.find((g) => haversine(g.lat, g.lng, a.lat, a.lng) * 1000 <= NEAR_M);
      if (at) at.items.push(a);
      else spots.push({ lat: a.lat, lng: a.lng, items: [a] });
    });

    const fanned = new Map();
    spots.forEach((g) => {
      const k = g.items.length;
      if (k < 2) return;
      // Enough room for k pins around the circle without them touching again.
      const r = Math.max(17, Math.round(5 * k));
      g.items.forEach((a, i) => {
        const ang = (-90 + (360 / k) * i) * (Math.PI / 180);
        fanned.set(a.id, { dx: Math.cos(ang) * r, dy: Math.sin(ang) * r, r });
      });
    });

    list.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = `gmk${sel === a.id ? ' gmk-focus' : ''}`;
      el.style.setProperty('--mk', colour(a));
      el.innerHTML = `<span>${i + 1}</span>`;
      /*
       * The name on the marker itself, not through the marker's `title`
       * option — that draws the operating system's tooltip, which is the one
       * thing this app has just finished getting rid of. aria-label carries
       * the same words for anything reading the page.
       */
      el.dataset.tip = a.title;
      el.setAttribute('aria-label', a.title);

      /* The pin is a rotated teardrop, so the nudge cannot go on the pin —
         it goes on a wrapper, which keeps the shape and carries the leader. */
      const fan = fanned.get(a.id);
      let content = el;
      if (fan) {
        content = document.createElement('div');
        content.className = 'gmk-fan';
        content.style.setProperty('--dx', `${Math.round(fan.dx)}px`);
        content.style.setProperty('--dy', `${Math.round(fan.dy)}px`);
        content.style.setProperty('--len', `${fan.r}px`);
        content.style.setProperty(
          '--ang',
          `${Math.round((Math.atan2(-fan.dy, -fan.dx) * 180) / Math.PI)}deg`,
        );
        content.appendChild(el);
      }

      const mark = new L.AdvancedMarkerElement({
        map, position: { lat: a.lat, lng: a.lng }, content,
      });
      mark.__id = a.id;
      mark.__el = el;
      mark.addListener('click', () => {
        // Clicking the marker whose card is already up closes it, the same way
        // clicking the map does.
        if (shownFor.current === mark) { closeInfo(); return; }
        const said = latest.current.describeStop
          ? latest.current.describeStop(a) : { meta: a.location || '' };
        openInfo(mark, {
          title: a.title,
          meta: said.meta,
          photoRef: a.photo_ref,
          photos: said.photos,
          placeId: a.place_id,
          action: 'Open activity',
          onAction: () => {
            info.current.close();
            if (latest.current.onStopOpen) latest.current.onStopOpen(a);
          },
        });
        if (focus) focus(a.id);
      });

      stopMarks.current.push(mark);
      bounds.extend({ lat: a.lat, lng: a.lng });
      const seen = byDay[a.day] || (byDay[a.day] = { line: colour(a), path: [] });
      seen.path.push({ lat: a.lat, lng: a.lng });
    });

    // The route line belongs to its day, so it wears the day's colour rather
    // than a fixed one that agreed with nothing on the map.
    Object.keys(byDay).forEach((d) => {
      if (byDay[d].path.length < 2) return;
      lines.current.push(new L.Polyline({
        path: byDay[d].path,
        strokeOpacity: 0,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.65, scale: 3 },
          offset: '0',
          repeat: '11px',
        }],
        strokeColor: byDay[d].line,
        map,
      }));
    });

    /*
     * While following, the view belongs to where you are standing and to
     * nothing else.
     *
     * This is drawn again on every render that changes the stops — and on a
     * route screen that is every position fix and every turn of the compass.
     * Each one used to re-aim at the single stop on the map, which is the
     * destination: hold the phone still and it stayed put, move and the map
     * leapt to the far end of the journey.
     */
    if (latest.current.follow) {
      // nothing to aim at: you are the centre until you say otherwise
    } else if (list.length === 1) {
      owedFit.current = { center: { lat: list[0].lat, lng: list[0].lng } };
    } else if (list.length > 1 && !bounds.isEmpty()) {
      owedFit.current = { bounds };
    } else if (!list.length && latest.current.look) {
      owedFit.current = { center: latest.current.look };
    }
    applyFit();
  }

  /**
   * One card for every marker.
   *
   * Suggestions used to get a photograph and a button while a stop already in
   * the plan got two lines of grey text — the same click on the same map
   * answering in two different registers. Built as DOM rather than an HTML
   * string so the picture and the buttons can carry real listeners; a string
   * would have to be re-found after the window opened.
   */
  function openInfo(anchor, card) {
    const map = mapRef.current;
    const el = createMapPopup(card, {
      onClose: closeInfo,
      onPhoto: (photo) => latest.current.onPhoto?.(photo),
    });

    /*
     * A new window each time, rather than one kept for the life of the map.
     *
     * The long-lived one reported itself open, on the right map, anchored to a
     * marker that was on screen — and rendered nothing at all. It is built
     * during the map's own construction, and in development React builds the
     * map twice; the window that survives is not the one the map kept. Making
     * it at the moment it is opened removes the question entirely, and one
     * small object per click is not a cost worth reasoning about.
     */
    /*
     * Built at the moment it opens rather than kept for the life of the map:
     * one small object per click, and no question about which map generation
     * it belongs to.
     */
    if (info.current) info.current.close();
    info.current = new libs.current.InfoWindow({ maxWidth: 268 });
    info.current.setContent(el);
    info.current.open({ map, anchor });
    shownFor.current = anchor;
  }

  function closeInfo() {
    if (info.current) info.current.close();
    shownFor.current = null;
  }

  /** A suggestion: not in the plan yet, so the action is to put it there. */
  function openPlaceInfo(p, anchor) {
    openInfo(anchor, {
      title: p.name,
      meta: placePopupMeta(p),
      photoRef: p.photo_ref,
      photos: p.photos,
      placeId: (p.place_id || String(p.id || '').replace(/^g-/, '')) || null,
      action: latest.current.onPlaceAdd ? 'Add to trip' : null,
      onAction: latest.current.onPlaceAdd
        ? () => { info.current.close(); latest.current.onPlaceAdd(p); }
        : null,
    });
  }

  function drawPlaces() {
    const L = libs.current;
    const map = mapRef.current;
    const { places: list, focusedPlace: sel, placeColour: colour } = latest.current;

    placeMarks.current.forEach((m) => { m.map = null; });
    placeMarks.current = [];

    list.forEach((p) => {
      const el = document.createElement('div');
      // A ringed point of interest, not a numbered teardrop: a suggestion is a
      // different kind of thing from a stop that is already in the plan, and
      // the map should not make you read a label to tell them apart.
      const cat = p.category || catForKind(p.kind);
      el.className = `gmk-place${sel === p.id ? ' is-on' : ''}`;
      el.style.setProperty('--mk', colour(cat));

      // What kind of place it is, readable without clicking it.
      const glyph = glyphs.current
        && glyphs.current.querySelector(`[data-cat="${cat}"] svg`);
      if (glyph) el.appendChild(glyph.cloneNode(true));

      el.dataset.tip = p.name;
      el.setAttribute('aria-label', p.name);

      const mark = new L.AdvancedMarkerElement({
        map, position: { lat: p.lat, lng: p.lng }, content: el,
      });
      mark.__id = p.id;
      mark.__el = el;
      mark.addListener('click', () => {
        if (shownFor.current === mark) { closeInfo(); return; }
        openPlaceInfo(p, mark);
        if (latest.current.onPlaceFocus) latest.current.onPlaceFocus(p.id);
      });
      placeMarks.current.push(mark);
    });
  }

  return (
    <>
      <div className="gmk-glyphs" ref={glyphs} aria-hidden="true">
        {MARKER_CATS.map((c) => {
          const Glyph = categoryIcon(c);
          return <span key={c} data-cat={c}><Glyph size={12} strokeWidth={2.75} /></span>;
        })}
      </div>
      <div className="map-el" ref={elRef} />
    </>
  );
}

/** Nearby kinds are not categories; this is the bridge for marker colour. */
function catForKind(kind) {
  return NEARBY_KINDS.find((k) => k.id === kind)?.category || 'other';
}
