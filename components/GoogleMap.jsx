'use client';
import { useEffect, useRef, useState } from 'react';
import { haversine } from '@/lib/geo';

// Must carry the NEXT_PUBLIC_ prefix: Next only exposes prefixed variables to
// the browser, and a map cannot be drawn without one there.
const KEY = process.env.NEXT_PUBLIC_MAPS_JAVASCRIPT_API_KEY || '';

// Advanced markers refuse to render without a Map ID. Google's demo id works
// out of the box; set NEXT_PUBLIC_MAPS_MAP_ID for a styled one.
const MAP_ID = process.env.NEXT_PUBLIC_MAPS_MAP_ID || 'DEMO_MAP_ID';

export function googleMapsAvailable() {
  return !!KEY && !KEY.startsWith('REPLACE_WITH');
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
  stops, places, focused, dayColours, onFocus, onDropPin, onViewport, onError,
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const libs = useRef(null);
  const stopMarks = useRef([]);
  const placeMarks = useRef([]);
  const lines = useRef([]);
  const info = useRef(null);
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
  const [ready, setReady] = useState(false);

  // Latest props, so drawing never closes over a stale render.
  const latest = useRef(null);
  latest.current = { stops, places, focused, dayColours, onFocus, onViewport };

  useEffect(() => {
    let dead = false;
    loadMaps().then((L) => {
      if (dead || !elRef.current || mapRef.current) return;
      libs.current = L;
      mapRef.current = new L.Map(elRef.current, {
        center: { lat: 35.68, lng: 139.76 },
        zoom: 4,
        mapId: MAP_ID,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        gestureHandling: 'cooperative',
      });
      info.current = new L.InfoWindow();
      mapRef.current.addListener('click', (e) => {
        if (e.latLng && onDropPin) onDropPin(e.latLng.lat(), e.latLng.lng());
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
  }, [ready, stops, focused]);

  useEffect(() => {
    if (ready) drawPlaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, places]);

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
      map.setCenter(want.center);
      map.setZoom(14);
    } else {
      map.fitBounds(want.bounds, 48);
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

      const mark = new L.AdvancedMarkerElement({
        map, position: { lat: a.lat, lng: a.lng }, content: el, title: a.title,
      });
      mark.addListener('click', () => {
        info.current.setContent(
          `<div class="gminfo"><strong>${escapeHtml(a.title)}</strong>`
          + (a.location ? `<div>${escapeHtml(a.location)}</div>` : '')
          + '</div>',
        );
        info.current.open({ map, anchor: mark });
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

  function drawPlaces() {
    const L = libs.current;
    const map = mapRef.current;
    const { places: list, dayColours: colour } = latest.current;

    placeMarks.current.forEach((m) => { m.map = null; });
    placeMarks.current = [];

    list.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'gmk-dot';
      el.style.setProperty('--mk', colour(p.category || 'other'));
      const mark = new L.AdvancedMarkerElement({
        map, position: { lat: p.lat, lng: p.lng }, content: el, title: p.name,
      });
      mark.addListener('click', () => {
        info.current.setContent(
          `<div class="gminfo"><strong>${escapeHtml(p.name)}</strong>`
          + (p.detail ? `<div>${escapeHtml(p.detail)}</div>` : '')
          + '</div>',
        );
        info.current.open({ map, anchor: mark });
      });
      placeMarks.current.push(mark);
    });
  }

  return <div className="map-el" ref={elRef} />;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
