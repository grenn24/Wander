'use client';
import { useEffect, useRef, useState } from 'react';
import { haversine, NEARBY_KINDS } from '@/lib/geo';
import { fit3DCamera, rangeToZoom, validMapPoint, viewport3D, zoomToRange } from '@/lib/map3dCamera';
import { move3DCamera } from '@/lib/map3dMotion';
import { createMapPopup, placePopupMeta } from '@/lib/mapPopup';
import { createPin } from '@/components/mapPin';
import styles from './PhotorealisticMap.module.css';

const EMPTY = [];
const DEFAULT_COLOUR = () => '#cd806a';

export default function PhotorealisticMap({ loadLibrary, camera, onFallback,
  stops = EMPTY, places = EMPTY, focused, focusedPlace, look,
  stopColour = DEFAULT_COLOUR, placeColour = DEFAULT_COLOUR,
  onFocus, onPlaceFocus, onStopOpen, onPlaceAdd, onViewport, describeStop, onPhoto,
  gestures = 'cooperative' }) {
  const host = useRef(null);
  const popupHost = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef(new Map());
  const restored = useRef(!!camera.current);
  const initialSelection = useRef(true);
  const lastFocus = useRef({ focused, focusedPlace });
  const selectedRef = useRef(null);
  const motion = useRef(null);
  const aimed = useRef(false);
  const latest = useRef(null);
  latest.current = { onFallback, onViewport, onFocus, onPlaceFocus, stopColour, placeColour, stops, places, look, describeStop, onStopOpen, onPlaceAdd, onPhoto };
  const [library, setLibrary] = useState(null);
  const [selection, setSelection] = useState(null);

  function moveTo(target, onComplete, animate = true) {
    motion.current?.();
    const map = mapRef.current;
    if (!map) return;
    motion.current = move3DCamera(map, target, {
      reducedMotion: !animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onComplete,
    });
  }

  function closeSelection() {
    selectedRef.current = null;
    setSelection(null);
    motion.current?.();
  }

  function selectPoint(point, kind, toggle = false) {
    const key = `${kind}:${point.id}`;
    if (selectedRef.current === key) {
      if (toggle) closeSelection();
      return;
    }
    selectedRef.current = key;
    setSelection({ key, kind, id: point.id });
    const map = mapRef.current;
    moveTo({ center: { lat: point.lat, lng: point.lng }, range: Math.min(map.range, 2200),
      heading: map.heading || 0, tilt: map.tilt });
  }

  function fit(animate = true) {
    const map = mapRef.current;
    if (!map) return;
    const next = fit3DCamera(latest.current.stops, latest.current.look, host.current.clientWidth / Math.max(1, host.current.clientHeight));
    closeSelection();
    moveTo(next, undefined, animate);
  }

  useEffect(() => {
    let dead = false, map, timer, reportTimer;
    const listeners = [];
    function listen(target, name, handler) {
      target.addEventListener(name, handler);
      listeners.push(() => target.removeEventListener(name, handler));
    }
    function fail() {
      if (dead) return;
      clearTimeout(timer);
      latest.current.onFallback('3D could not load here. Showing the road map instead.');
    }
    function remember() {
      if (!map || !validMapPoint(map.center)) return;
      const center = { lat: map.center.lat, lng: map.center.lng };
      camera.current = { center, heading: map.heading || 0,
        zoom: rangeToZoom(map.range, center.lat, host.current?.clientHeight || 600),
        range: map.range, tilt: map.tilt };
    }
    function report() {
      if (dead || !map) return;
      remember();
      const view = viewport3D(map.center, map.range);
      if (view) latest.current.onViewport?.(view);
    }
    // Do not leave a blank map indefinitely on
    // unsupported GPUs, rejected keys, or interrupted mobile connections.
    timer = setTimeout(fail, 45000);
    loadLibrary().then((L) => {
      if (dead || !host.current) return;
      const saved = camera.current;
      const initial = saved ? { center: saved.center, heading: saved.heading || 0, tilt: saved.tilt ?? 60,
        range: zoomToRange(saved.zoom, saved.center.lat, host.current.clientHeight) }
        : fit3DCamera(latest.current.stops, latest.current.look, host.current.clientWidth / Math.max(1, host.current.clientHeight));
      map = new L.Map3DElement({ ...initial, mode: 'HYBRID', defaultUIHidden: true,
        gestureHandling: gestures.toUpperCase() });
      map.setAttribute('aria-label', 'Photorealistic 3D trip map');
      mapRef.current = map;
      listen(map, 'gmp-error', fail);
      listen(map, 'gmp-steadychange', (event) => {
        if (event.isSteady) { clearTimeout(timer); report(); }
      });
      ['gmp-centerchange', 'gmp-rangechange', 'gmp-headingchange', 'gmp-tiltchange'].forEach((name) => listen(map, name, () => {
        remember();
        clearTimeout(reportTimer);
        reportTimer = setTimeout(report, 250);
      }));
      listen(map, 'gmp-click', (event) => {
        event.preventDefault();
        // Marker and popover events are not clicks on the bare map.
        if (event.composedPath().some((node) => ['GMP-MARKER-INTERACTIVE', 'GMP-POPOVER'].includes(node.tagName))) return;
        closeSelection();
      });
      host.current.append(map);
      setLibrary(L);
    }).catch(fail);
    return () => {
      remember();
      dead = true;
      clearTimeout(timer);
      clearTimeout(reportTimer);
      listeners.forEach((remove) => remove());
      motion.current?.();
      map?.remove();
      mapRef.current = null;
    };
  }, [loadLibrary, camera, gestures]);

  // Data updates rebuild the overlays, not the expensive 3D renderer. Selection
  // is separate, so tapping a pin does not destroy the pin's open popover.
  useEffect(() => {
    if (!library || !mapRef.current) return;
    const map = mapRef.current;
    const overlays = [];
    markers.current.clear();
    const fans = new Map();
    const groups = [];
    stops.filter(validMapPoint).forEach((stop) => {
      const group = groups.find((items) => haversine(items[0].lat, items[0].lng, stop.lat, stop.lng) < 0.03);
      if (group) group.push(stop); else groups.push([stop]);
    });
    groups.filter((items) => items.length > 1).forEach((items) => items.forEach((stop, i) => {
      const angle = i * Math.PI * 2 / items.length;
      const radius = Math.max(24, items.length * 8);
      fans.set(stop.id, [Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }));
    function addMarker(point, index, kind) {
      if (!validMapPoint(point)) return;
      const key = `${kind}:${point.id}`;
      const category = point.category || NEARBY_KINDS.find((entry) => entry.id === point.kind)?.category || 'other';
      const colour = kind === 'stop' ? latest.current.stopColour(point) : latest.current.placeColour(category);
      /*
       * The map's one pin (components/mapPin): a stop numbered in its day's
       * colour, a suggestion a smaller plain circle in its category's. Its name
       * is the app's tooltip rather than the system's.
       *
       * The 3D map draws only inside a marker's own box, so the pin has room
       * around it to grow under a pointer. The box is centred on the place; a
       * stop sharing its spot with others is moved by the anchor, box and all,
       * so it neither gets clipped nor lays an invisible box over its neighbours.
       */
      const size = kind === 'stop' ? 26 : 20;
      const pin = createPin({
        label: kind === 'stop' ? index + 1 : '',
        colour,
        size,
        name: kind === 'stop' ? `${index + 1}. ${point.title}` : point.name,
      });
      const pad = Math.round(size * 0.45);
      const room = document.createElement('div');
      room.style.padding = `${pad}px`;
      room.append(pin.el);
      const fan = (kind === 'stop' && fans.get(point.id)) || [0, 0];
      const half = size / 2 + pad;
      const marker = new library.MarkerInteractiveElement({ position: { lat: point.lat, lng: point.lng },
        altitudeMode: 'CLAMP_TO_GROUND', collisionBehavior: 'REQUIRED',
        anchorLeft: `${Math.round(fan[0] - half)}px`, anchorTop: `${Math.round(fan[1] - half)}px` });
      marker.append(room);
      marker.addEventListener('gmp-click', (event) => {
        event.stopPropagation();
        selectPoint(point, kind, true);
        if (kind === 'stop') latest.current.onFocus?.(point.id);
        else latest.current.onPlaceFocus?.(point.id);
      });
      map.append(marker);
      overlays.push(marker);
      markers.current.set(key, { marker, pin, kind });
    }
    stops.forEach((point, i) => addMarker(point, i, 'stop'));
    places.forEach((point, i) => addMarker(point, i, 'place'));
    const days = new Map();
    stops.filter(validMapPoint).forEach((point) => {
      if (!days.has(point.day)) days.set(point.day, []);
      days.get(point.day).push(point);
    });
    days.forEach((points) => {
      if (points.length < 2) return;
      const line = new library.Polyline3DElement({ altitudeMode: 'CLAMP_TO_GROUND',
        strokeColor: latest.current.stopColour(points[0]), strokeWidth: 3,
        drawsOccludedSegments: true,
        path: points.map(({ lat, lng }) => ({ lat, lng })) });
      map.append(line);
      overlays.push(line);
    });
    return () => { overlays.forEach((overlay) => overlay.remove()); markers.current.clear(); };
  }, [library, stops, places]);

  const extent = JSON.stringify(stops.map(({ id, lat, lng }) => [id, lat, lng]));
  useEffect(() => {
    if (!library) return;
    if (restored.current) { restored.current = false; aimed.current = true; return; }
    fit(aimed.current);
    aimed.current = true;
  }, [library, extent, look?.lat, look?.lng]);

  useEffect(() => {
    if (!library) return;
    const previous = lastFocus.current;
    lastFocus.current = { focused, focusedPlace };
    if (initialSelection.current) { initialSelection.current = false; return; }
    const kind = focused && focused !== previous.focused ? 'stop' : 'place';
    const id = kind === 'stop' ? focused : focusedPlace !== previous.focusedPlace ? focusedPlace : null;
    if (!id) return;
    const point = (kind === 'place' ? places : stops).find((p) => p.id === id);
    if (!validMapPoint(point)) return;
    selectPoint(point, kind);
  }, [library, focused, focusedPlace]);

  useEffect(() => {
    if (!library) return;
    markers.current.forEach(({ marker, pin }, key) => {
      const on = key === selection?.key;
      pin.set({ active: on });
      // Markers are drawn in the order they were added: the chosen one goes last, over its neighbours.
      if (on && marker.parentNode && marker.parentNode.lastElementChild !== marker) marker.parentNode.append(marker);
    });
    const isStop = selection?.kind === 'stop';
    const item = (isStop ? stops : places).find((point) => point.id === selection?.id);
    if (!selection || !item || !popupHost.current) return;
    const detail = isStop ? latest.current.describeStop?.(item) : null;
    const action = isStop ? latest.current.onStopOpen : latest.current.onPlaceAdd;
    const content = createMapPopup({
      title: isStop ? item.title : item.name,
      meta: isStop ? detail?.meta || item.location : placePopupMeta(item),
      photoRef: item.photo_ref,
      photos: detail?.photos || item.photos,
      placeId: item.place_id || (!isStop ? String(item.id || '').replace(/^g-/, '') : null),
      action: action ? isStop ? 'Open activity' : 'Add to trip' : null,
      onAction: action ? () => {
        closeSelection();
        if (isStop) latest.current.onStopOpen?.(item);
        else latest.current.onPlaceAdd?.(item);
      } : null,
    }, {
      onClose: closeSelection,
      onPhoto: (photo) => latest.current.onPhoto?.(photo),
    });
    // Keep the card in our DOM so camera flights and replacement SDK markers
    // cannot hide it or detach its anchor. Selection opens it immediately.
    popupHost.current.append(content);
    return () => content.remove();
  }, [library, selection, stops, places]);

  return <div className={styles.root} onKeyDown={(event) => {
    if (event.key === 'Escape') closeSelection();
  }}>
    <div ref={host} className={styles.canvas} />
    <div ref={popupHost} className={styles.popup} role="region" aria-label="Selected map place" hidden={!selection} />
  </div>;
}
