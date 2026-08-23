'use client';
import { useEffect, useRef, useState } from 'react';
import { haversine } from '@/lib/geo';
import { categoryIcon } from '@/lib/icons';

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
export default function GoogleMap({
  stops, places, focused, focusedPlace, dayColours,
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
  // Whether the map has ever been aimed. The first fit is ours to make; after
  // that the view belongs to whoever is looking at it.
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);

  // Latest props, so drawing never closes over a stale render.
  const latest = useRef(null);
  latest.current = {
    stops, places, focused, focusedPlace, dayColours,
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
        colorScheme: readScheme(),
        // No furniture at all. Scroll, pinch and double-tap are how anyone
        // actually zooms a map, and a pair of grey buttons in the corner of a
        // full-bleed map is a widget sitting on a photograph.
        disableDefaultUI: true,
        zoomControl: false,
        clickableIcons: false,
        gestureHandling: gestures,
      });
      mapRef.current.addListener('click', (e) => {
        /*
         * With a callout open, a click on the map means "put that away" and
         * nothing else. It used to drop a pin as well, so dismissing the card
         * left a new point behind — every time.
         */
        if (shownFor.current) { closeInfo(); return; }
        // Through latest, not the closure: this listener is attached once, so a
        // handler captured here would be the first render's for the map's whole
        // life — and would never see anything the page learned since.
        const drop = latest.current.onDropPin;
        if (e.latLng && drop) drop(e.latLng.lat(), e.latLng.lng());
      });
      /*
       * "Nearby" means near what you are looking at, so the map has to say
       * where that is. `idle` fires once panning and zooming have settled
       * rather than on every frame of the gesture.
       */
      mapRef.current.addListener('idle', () => {
        applyFit();
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
          // Clamped to what the Places API will actually search...
          radius: Math.round(Math.min(4000, Math.max(300, km * 1000))),
          // ...and unclamped, so the page can admit when the view is wider
          // than the search can reach.
          spanKm: km,
        });
      });
      setReady(true);
    }).catch((e) => { if (!dead && onError) onError(e.message); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) drawStops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stops]);

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

  /** Apply an owed fit, but only once the map is big enough to have an opinion. */
  function applyFit() {
    const map = mapRef.current;
    const el = elRef.current;
    const want = owedFit.current;
    if (!map || !want || !el || !el.clientHeight || !el.clientWidth) return;
    owedFit.current = null;
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

  function drawStops() {
    const L = libs.current;
    const map = mapRef.current;
    const { stops: list, focused: sel, dayColours: colour, onFocus: focus } = latest.current;

    stopMarks.current.forEach((m) => { m.map = null; });
    stopMarks.current = [];
    lines.current.forEach((l) => l.setMap(null));
    lines.current = [];

    const byDay = {};
    const bounds = new L.LatLngBounds();

    list.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = `gmk${sel === a.id ? ' gmk-focus' : ''}`;
      el.style.setProperty('--mk', colour(a.category));
      el.innerHTML = `<span>${i + 1}</span>`;
      /*
       * The name on the marker itself, not through the marker's `title`
       * option — that draws the operating system's tooltip, which is the one
       * thing this app has just finished getting rid of. aria-label carries
       * the same words for anything reading the page.
       */
      el.dataset.tip = a.title;
      el.setAttribute('aria-label', a.title);

      const mark = new L.AdvancedMarkerElement({
        map, position: { lat: a.lat, lng: a.lng }, content: el,
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
      (byDay[a.day] = byDay[a.day] || []).push({ lat: a.lat, lng: a.lng });
    });

    Object.keys(byDay).forEach((d) => {
      if (byDay[d].length < 2) return;
      lines.current.push(new L.Polyline({
        path: byDay[d],
        strokeOpacity: 0,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.65, scale: 3 },
          offset: '0',
          repeat: '11px',
        }],
        strokeColor: colour('sightseeing'),
        map,
      }));
    });

    if (list.length === 1) {
      owedFit.current = { center: { lat: list[0].lat, lng: list[0].lng } };
    } else if (list.length > 1 && !bounds.isEmpty()) {
      owedFit.current = { bounds };
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
    const el = document.createElement('div');
    el.className = 'gminfo';

    const shut = document.createElement('button');
    shut.type = 'button';
    shut.className = 'gminfo-x';
    shut.dataset.tip = 'Close';
    shut.setAttribute('aria-label', 'Close');
    shut.innerHTML = '&#10005;';
    shut.addEventListener('click', closeInfo);
    el.appendChild(shut);

    if (card.photoRef) {
      const shot = document.createElement('button');
      shot.type = 'button';
      shot.className = 'gminfo-shot';
      shot.dataset.tip = 'See the photos';
      shot.setAttribute('aria-label', `Photos of ${card.title}`);
      const img = document.createElement('img');
      img.alt = '';
      img.src = `/api/places/photo?ref=${encodeURIComponent(card.photoRef)}&w=420`;
      shot.appendChild(img);
      shot.addEventListener('click', () => {
        const show = latest.current.onPhoto;
        if (show) {
          show({
            photoRef: card.photoRef,
            photos: card.photos,
            placeId: card.placeId,
            title: card.title,
          });
        }
      });
      el.appendChild(shot);
    }

    const body = document.createElement('div');
    body.className = 'gminfo-body';
    body.innerHTML = `<strong class="gminfo-title">${escapeHtml(card.title || '')}</strong>`
      + (card.meta ? `<div class="gminfo-meta">${escapeHtml(card.meta)}</div>` : '');
    el.appendChild(body);

    if (card.action && card.onAction) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'gminfo-go';
      go.textContent = card.action;
      go.addEventListener('click', card.onAction);
      body.appendChild(go);
    }

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
    const bits = [];
    if (p.detail) bits.push(p.detail);
    if (p.rating) bits.push(`★ ${Number(p.rating).toFixed(1)}`);
    if (p.km != null) bits.push(`${p.km < 1 ? `${Math.round(p.km * 1000)} m` : `${p.km.toFixed(1)} km`} away`);

    openInfo(anchor, {
      title: p.name,
      meta: bits.join(' · '),
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
    const { places: list, focusedPlace: sel, dayColours: colour } = latest.current;

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
  return ({
    food: 'food', sights: 'sightseeing', transit: 'transport', shops: 'shopping',
  })[kind] || 'other';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
