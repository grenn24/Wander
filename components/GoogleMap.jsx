'use client';
import { useEffect, useRef } from 'react';

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export function googleMapsAvailable() {
  return !!KEY && !KEY.startsWith('REPLACE_WITH');
}

let loader = null;

function loadMaps() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}`
      + '&libraries=marker&loading=async&v=weekly';
    s.async = true;
    s.addEventListener('load', () => resolve(window.google.maps));
    s.addEventListener('error', () => reject(new Error('Google Maps failed to load')));
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
  stops, places, focused, dayColours, onFocus, onDropPin, onReady, onError,
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const stopMarks = useRef([]);
  const placeMarks = useRef([]);
  const lines = useRef([]);
  const info = useRef(null);

  useEffect(() => {
    let dead = false;
    loadMaps().then((maps) => {
      if (dead || !elRef.current) return;
      if (!mapRef.current) {
        mapRef.current = new maps.Map(elRef.current, {
          center: { lat: 35.68, lng: 139.76 },
          zoom: 4,
          mapId: 'wander',
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'cooperative',
        });
        info.current = new maps.InfoWindow();
        mapRef.current.addListener('click', (e) => {
          if (!e.latLng || !onDropPin) return;
          onDropPin(e.latLng.lat(), e.latLng.lng());
        });
        if (onReady) onReady();
      }
      draw(maps);
    }).catch((e) => { if (onError) onError(e.message); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !window.google) return;
    draw(window.google.maps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, focused]);

  useEffect(() => {
    if (!mapRef.current || !window.google) return;
    drawPlaces(window.google.maps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  function clearStops() {
    stopMarks.current.forEach((m) => { m.map = null; });
    stopMarks.current = [];
    lines.current.forEach((l) => l.setMap(null));
    lines.current = [];
  }

  function draw(maps) {
    const map = mapRef.current;
    clearStops();

    const byDay = {};
    const bounds = new maps.LatLngBounds();

    stops.forEach((a, i) => {
      const colour = dayColours(a.category);
      const el = document.createElement('div');
      el.className = `gmk${focused === a.id ? ' gmk-focus' : ''}`;
      el.style.setProperty('--mk', colour);
      el.innerHTML = `<span>${i + 1}</span>`;

      const mark = new maps.marker.AdvancedMarkerElement({
        map, position: { lat: a.lat, lng: a.lng }, content: el, title: a.title,
      });
      mark.addListener('click', () => {
        info.current.setContent(
          `<div class="gminfo"><strong>${escapeHtml(a.title)}</strong>`
          + (a.location ? `<div>${escapeHtml(a.location)}</div>` : '')
          + '</div>',
        );
        info.current.open({ map, anchor: mark });
        if (onFocus) onFocus(a.id);
      });
      stopMarks.current.push(mark);
      bounds.extend({ lat: a.lat, lng: a.lng });
      (byDay[a.day] = byDay[a.day] || []).push({ lat: a.lat, lng: a.lng });
    });

    Object.keys(byDay).forEach((d) => {
      if (byDay[d].length < 2) return;
      const line = new maps.Polyline({
        path: byDay[d],
        strokeOpacity: 0,
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, scale: 3 },
          offset: '0', repeat: '11px',
        }],
        strokeColor: dayColours('sightseeing'),
        map,
      });
      lines.current.push(line);
    });

    if (stops.length === 1) { map.setCenter({ lat: stops[0].lat, lng: stops[0].lng }); map.setZoom(14); }
    else if (stops.length > 1) map.fitBounds(bounds, 48);
  }

  function drawPlaces(maps) {
    const map = mapRef.current;
    placeMarks.current.forEach((m) => { m.map = null; });
    placeMarks.current = [];
    places.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'gmk-dot';
      el.style.setProperty('--mk', dayColours(p.category || 'other'));
      const mark = new maps.marker.AdvancedMarkerElement({
        map, position: { lat: p.lat, lng: p.lng }, content: el, title: p.name,
      });
      mark.addListener('click', () => {
        info.current.setContent(`<div class="gminfo"><strong>${escapeHtml(p.name)}</strong></div>`);
        info.current.open({ map, anchor: mark });
      });
      placeMarks.current.push(mark);
    });
  }

  /** Pan to a stop from outside the map. */
  useEffect(() => {
    if (!mapRef.current || !focused) return;
    const at = stops.find((s) => s.id === focused);
    if (!at) return;
    mapRef.current.panTo({ lat: at.lat, lng: at.lng });
    if (mapRef.current.getZoom() < 14) mapRef.current.setZoom(14);
  }, [focused, stops]);

  return <div className="map-el" ref={elRef} />;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
