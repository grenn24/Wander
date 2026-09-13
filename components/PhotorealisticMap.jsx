'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LocateFixed, RotateCcw, RotateCw, MapPinPlus, X } from 'lucide-react';
import PlacePhoto from './PlacePhoto';
import { haversine, NEARBY_KINDS } from '@/lib/geo';
import { fit3DCamera, rangeToZoom, validMapPoint, viewport3D, zoomToRange } from '@/lib/map3dCamera';
import { move3DCamera } from '@/lib/map3dMotion';
import styles from './PhotorealisticMap.module.css';

const EMPTY = [];
const DEFAULT_COLOUR = () => '#cd806a';

export default function PhotorealisticMap({ loadLibrary, camera, onFallback, onExit,
  stops = EMPTY, places = EMPTY, focused, focusedPlace, look,
  stopColour = DEFAULT_COLOUR, placeColour = DEFAULT_COLOUR,
  onFocus, onPlaceFocus, onStopOpen, onPlaceAdd, onDropPin, onViewport, describeStop, onPhoto,
  gestures = 'cooperative' }) {
  const host = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef(new Map());
  const restored = useRef(!!camera.current);
  const initialSelection = useRef(true);
  const lastFocus = useRef({ focused, focusedPlace });
  const selectedRef = useRef(null);
  const motion = useRef(null);
  const aimed = useRef(false);
  const latest = useRef(null);
  latest.current = { onFallback, onViewport, onFocus, onPlaceFocus, stopColour, placeColour, stops, places, look, onDropPin };
  const [library, setLibrary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState(null);
  const [cardReady, setCardReady] = useState(false);
  const [popupHost, setPopupHost] = useState(null);
  const [dropping, setDropping] = useState(false);
  const dropRef = useRef(false);
  dropRef.current = dropping;

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
    setCardReady(false);
    motion.current?.();
  }

  function selectPoint(point, kind, toggle = false) {
    const key = `${kind}:${point.id}`;
    if (selectedRef.current === key) {
      if (toggle) closeSelection();
      return;
    }
    selectedRef.current = key;
    setCardReady(false);
    setSelection({ key, kind, id: point.id });
    const map = mapRef.current;
    moveTo({ center: { lat: point.lat, lng: point.lng }, range: Math.min(map.range, 2200),
      heading: map.heading || 0, tilt: map.tilt }, () => {
      if (selectedRef.current === key) setCardReady(true);
    });
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
    // Do not leave a blank map behind a loading indicator indefinitely on
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
        if (event.isSteady) { clearTimeout(timer); setLoading(false); report(); }
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
        if (dropRef.current && validMapPoint(event.position)) {
          dropRef.current = false;
          setDropping(false);
          latest.current.onDropPin?.(event.position.lat, event.position.lng);
        }
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
      // HTML markers stay keyboard-accessible and allow shared-location stops
      // to fan out, while their geographic anchors remain unchanged.
      const marker = new library.MarkerInteractiveElement({ position: { lat: point.lat, lng: point.lng },
        altitudeMode: 'CLAMP_TO_GROUND', collisionBehavior: 'REQUIRED',
        title: kind === 'stop' ? `${index + 1}. ${point.title}` : point.name });
      const pin = new library.PinElement({ background: colour, borderColor: '#ffffff', glyphColor: '#ffffff',
        glyphText: kind === 'stop' ? String(index + 1) : '•', scale: kind === 'stop' ? 1 : 0.85 });
      const fan = kind === 'stop' && fans.get(point.id);
      if (fan) {
        const wrapper = document.createElement('div');
        wrapper.style.transform = `translate(${fan[0]}px, ${fan[1]}px)`;
        wrapper.append(pin);
        marker.append(wrapper);
      } else marker.append(pin);
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
    markers.current.forEach(({ pin, kind }, key) => {
      pin.scale = key === selection?.key ? 1.25 : kind === 'stop' ? 1 : 0.85;
    });
    const marker = markers.current.get(selection?.key)?.marker;
    if (!marker || !cardReady) { setPopupHost(null); return; }
    // Wander owns the camera move. Google's automatic popover pan used to race
    // that move, briefly showing a card and then dismissing it mid-flight.
    const popover = new library.PopoverElement({ positionAnchor: marker, open: true, lightDismissDisabled: true, autoPanDisabled: true });
    popover.className = styles.bubble;
    const content = document.createElement('div');
    popover.append(content);
    mapRef.current.append(popover);
    setPopupHost(content);
    return () => popover.remove();
  }, [library, selection, cardReady, stops, places]);

  const item = selection && (selection.kind === 'stop' ? stops : places).find((p) => p.id === selection.id);
  const isStop = selection?.kind === 'stop';
  const meta = item ? isStop ? describeStop?.(item)?.meta || item.location : item.detail : '';
  return <div className={styles.root} onKeyDown={(event) => {
    if (event.key === 'Escape') { closeSelection(); setDropping(false); }
  }}>
    <div ref={host} className={styles.canvas} />
    <div className={styles.tools} role="group" aria-label="3D map controls">
      <button type="button" className={styles.exit} onClick={onExit} aria-label="Return to road map">2D</button>
      <button type="button" onClick={() => fit()} aria-label="Show all visible stops" data-tip="Show stops"><LocateFixed size={18} /></button>
      <button type="button" onClick={() => { if (mapRef.current) mapRef.current.heading -= 30; }} aria-label="Rotate left" data-tip="Rotate left"><RotateCcw size={18} /></button>
      <button type="button" onClick={() => { if (mapRef.current) mapRef.current.heading += 30; }} aria-label="Rotate right" data-tip="Rotate right"><RotateCw size={18} /></button>
      {onDropPin ? <button type="button" onClick={() => setDropping(!dropping)} aria-label={dropping ? 'Cancel adding a pin' : 'Add a pin'} aria-pressed={dropping} data-tip="Add a pin"><MapPinPlus size={18} /></button> : null}
    </div>
    {loading ? <div className={styles.loading} role="status"><span>Loading 3D scenery…</span><button className="btn small" onClick={onExit}>Use 2D</button></div> : null}
    {dropping ? <div className={styles.hint} role="status">Tap a spot on the map to add a stop.</div> : null}
    {popupHost && item ? createPortal(<div className={styles.popup}>
      <header><PlacePhoto photoRef={item.photo_ref} category={item.category} size={40} />
        <strong>{isStop ? item.title : item.name}</strong>
        <button type="button" className="btn icon-btn" aria-label="Close place details" onClick={closeSelection}><X size={15} /></button></header>
      {meta ? <p>{meta}</p> : null}
      {item.photo_ref && onPhoto ? <button type="button" className="btn small" onClick={() => onPhoto({ photoRef: item.photo_ref, photos: item.photos, placeId: item.place_id, title: item.title || item.name })}>View photos</button> : null}
      {(isStop ? onStopOpen : onPlaceAdd) ? <button type="button" className="btn primary" onClick={() => {
        closeSelection();
        if (isStop) onStopOpen(item); else onPlaceAdd(item);
      }}>{isStop ? 'Open activity' : 'Add to trip'}</button> : null}
    </div>, popupHost) : null}
  </div>;
}
