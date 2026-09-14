'use client';
import { useEffect, useRef, useState } from 'react';
import { load3D, loadMaps, googleMapsAvailable, readScheme } from '@/components/GoogleMap';
import { flightMillis } from '@/lib/globe';
import { rangeToZoom } from '@/lib/map3dCamera';
import s from './Globe.module.css';

const MAP_ID = process.env.NEXT_PUBLIC_MAPS_MAP_ID || 'DEMO_MAP_ID';
const GLYPH = { been: '✓', planned: '•', want: '★', preview: '+' };
const COLOUR_VAR = { been: '--accent', planned: '--warn', want: '--good', idea: '--text-3', preview: '--text-1' };

function colour(kind) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(COLOUR_VAR[kind] || '--accent').trim();
  return v || '#a34f35';
}

// A pin is the same pin while it is the same place of the same kind; anything
// else about it can change without the marker being replaced.
const keyOf = (p) => `${p.id}|${p.kind}|${p.lat}|${p.lng}`;

/**
 * The globe itself: Google's photorealistic 3D Earth, which zooms from space
 * to a street without changing renderer.
 *
 * It needs WebGL and the Map Tiles API. Where either is missing it falls back
 * to the flat map at world zoom rather than a blank screen, and says so once.
 *
 * `aim` is a camera plus a key: a new key means fly there, even to the same
 * place again, which is what "show me the whole globe" pressed twice needs.
 */
export default function GlobeCanvas({ points, selectedId, aim, onSelect }) {
  const host = useRef(null);
  const map3d = useRef(null);
  const map2d = useRef(null);
  const lib = useRef(null);
  const pins = useRef(new Map()); // key -> { id, kind, marker, pin?, dot?, remove }
  const latest = useRef(null);
  latest.current = { onSelect, aim, selectedId };
  const [mode, setMode] = useState(() => (googleMapsAvailable() ? '3d' : 'none'));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (mode !== '3d') return undefined;
    let dead = false;
    let map = null;
    const offs = [];
    const listen = (target, name, fn) => {
      target.addEventListener(name, fn);
      offs.push(() => target.removeEventListener(name, fn));
    };
    const fallback = () => { if (!dead) setMode('2d'); };
    // A GPU that cannot, or a key without Map Tiles, can leave the canvas
    // silently empty. Nothing steady within this long means it is not coming.
    const timer = setTimeout(fallback, 45000);
    load3D().then((L) => {
      if (dead || !host.current) return;
      lib.current = L;
      const a = latest.current.aim && latest.current.aim.camera;
      const start = a || { center: { lat: 22, lng: 100 }, range: 19000000, tilt: 0, heading: 0 };
      map = new L.Map3DElement({
        center: start.center, range: start.range, tilt: start.tilt, heading: start.heading,
        mode: 'HYBRID', defaultUIHidden: true, gestureHandling: 'GREEDY',
      });
      map.setAttribute('aria-label', 'Globe of your places');
      listen(map, 'gmp-error', fallback);
      listen(map, 'gmp-steadychange', (e) => { if (e.isSteady) clearTimeout(timer); });
      listen(map, 'gmp-click', (e) => {
        e.preventDefault();
        if (e.composedPath().some((n) => n.tagName === 'GMP-MARKER-INTERACTIVE')) return;
        latest.current.onSelect(null);
      });
      host.current.append(map);
      map3d.current = map;
      setReady(true);
    }).catch(fallback);
    return () => {
      dead = true;
      clearTimeout(timer);
      offs.forEach((off) => off());
      if (map) map.remove(); // takes its markers with it
      pins.current.clear();
      map3d.current = null;
      setReady(false);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== '2d') return undefined;
    let dead = false;
    const el = host.current;
    loadMaps().then((L) => {
      if (dead || !el) return;
      lib.current = L;
      const a = latest.current.aim && latest.current.aim.camera;
      const map = new L.Map(el, {
        center: a ? a.center : { lat: 20, lng: 10 },
        zoom: a ? Math.round(rangeToZoom(a.range, a.center.lat, el.clientHeight)) : 2,
        minZoom: 2,
        mapId: MAP_ID,
        colorScheme: readScheme(),
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
      });
      map.addListener('click', () => latest.current.onSelect(null));
      map2d.current = map;
      setReady(true);
    }).catch(() => { if (!dead) setMode('none'); });
    return () => {
      dead = true;
      pins.current.forEach((entry) => entry.remove());
      pins.current.clear();
      map2d.current = null;
      setReady(false);
      if (el) el.replaceChildren();
    };
  }, [mode]);

  /*
   * The selected pin, drawn larger, in place.
   *
   * Selection used to redraw every pin. A 3D marker added while the camera is
   * flying has to find the ground again, so each click made the whole globe's
   * pins blink out and back as it zoomed in. Now a click changes the size of
   * one pin, and a selected idea stops giving way to labels so it cannot be
   * hidden on the way down.
   */
  function restyle() {
    const selected = latest.current.selectedId;
    pins.current.forEach((entry) => {
      const on = entry.id === selected;
      if (entry.pin) {
        entry.pin.scale = on ? 1.35 : entry.kind === 'idea' ? 0.8 : 1;
        const collide = entry.kind === 'idea' && !on ? 'OPTIONAL_AND_HIDES_LOWER_PRIORITY' : 'REQUIRED';
        if (entry.marker.collisionBehavior !== collide) entry.marker.collisionBehavior = collide;
      }
      if (entry.dot) {
        entry.dot.toggleAttribute('data-on', on);
        entry.marker.zIndex = on ? 1000 : entry.kind === 'idea' ? 1 : 10;
      }
    });
  }

  function add3D(L, p) {
    const marker = new L.MarkerInteractiveElement({
      position: { lat: p.lat, lng: p.lng },
      altitudeMode: 'CLAMP_TO_GROUND',
      // Ideas give way to your own places when they collide.
      collisionBehavior: p.kind === 'idea' ? 'OPTIONAL_AND_HIDES_LOWER_PRIORITY' : 'REQUIRED',
      title: p.name,
    });
    const pin = new L.PinElement({
      background: colour(p.kind),
      borderColor: '#ffffff',
      glyphColor: '#ffffff',
      ...(GLYPH[p.kind] ? { glyphText: GLYPH[p.kind] } : {}),
      scale: p.kind === 'idea' ? 0.8 : 1,
    });
    marker.append(pin);
    marker.addEventListener('gmp-click', (e) => {
      e.stopPropagation();
      latest.current.onSelect(p.id);
    });
    map3d.current.append(marker);
    return { id: p.id, kind: p.kind, marker, pin, remove: () => marker.remove() };
  }

  function add2D(L, p) {
    const dot = document.createElement('div');
    dot.className = s.pin;
    dot.dataset.kind = p.kind;
    dot.textContent = GLYPH[p.kind] || '';
    const marker = new L.AdvancedMarkerElement({
      map: map2d.current,
      position: { lat: p.lat, lng: p.lng },
      content: dot,
      title: p.name,
      gmpClickable: true,
      zIndex: p.kind === 'idea' ? 1 : 10,
    });
    marker.addListener('click', () => latest.current.onSelect(p.id));
    return { id: p.id, kind: p.kind, marker, dot, remove: () => { marker.map = null; } };
  }

  // Add the pins that are new and remove the ones that have gone; leave the
  // rest exactly where they are.
  useEffect(() => {
    const L = lib.current;
    if (!ready || !L) return;
    if (mode === '3d' && !map3d.current) return;
    if (mode === '2d' && !map2d.current) return;
    const wanted = new Map(points.map((p) => [keyOf(p), p]));
    pins.current.forEach((entry, key) => {
      if (wanted.has(key)) return;
      entry.remove();
      pins.current.delete(key);
    });
    wanted.forEach((p, key) => {
      if (!pins.current.has(key)) pins.current.set(key, mode === '3d' ? add3D(L, p) : add2D(L, p));
    });
    restyle();
  }, [ready, mode, points]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready) restyle();
  }, [ready, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !aim) return;
    const cam = aim.camera;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (mode === '3d' && map3d.current) {
      const map = map3d.current;
      const ms = aim.instant || still ? 0 : flightMillis({ center: map.center, range: map.range }, cam);
      try { Promise.resolve(map.stopCameraAnimation && map.stopCameraAnimation()).catch(() => {}); } catch (e) { /* nothing flying */ }
      if (!ms || typeof map.flyCameraTo !== 'function') {
        Object.assign(map, cam);
        return;
      }
      try {
        Promise.resolve(map.flyCameraTo({ endCamera: cam, durationMillis: ms })).catch(() => Object.assign(map, cam));
      } catch (e) {
        Object.assign(map, cam);
      }
    } else if (mode === '2d' && map2d.current) {
      const h = host.current ? host.current.clientHeight : 600;
      map2d.current.panTo(cam.center);
      map2d.current.setZoom(Math.round(rangeToZoom(cam.range, cam.center.lat, h)));
    }
  }, [aim, ready, mode]);

  return (
    <>
      <div ref={host} className={s.host} />
      {mode === '2d' ? (
        <p className={s.notice} role="status">3D could not load here, so this is the flat map.</p>
      ) : null}
      {mode === 'none' ? (
        <div className={s.nokey}><p>Maps are switched off right now.</p></div>
      ) : null}
    </>
  );
}
