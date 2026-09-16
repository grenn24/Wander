'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { load3D, loadMaps, googleMapsAvailable, readScheme } from '@/components/GoogleMap';
import { flightMillis } from '@/lib/globe';
import {
  prepareCountries, prepareAreas, areaFilesFor, regionsFor, regionStrength, areaStrength,
} from '@/lib/globeRegions';
import { rangeToZoom } from '@/lib/map3dCamera';
import { createStamp } from '@/components/globeStamp';
import s from './Globe.module.css';

const MAP_ID = process.env.NEXT_PUBLIC_MAPS_MAP_ID || 'DEMO_MAP_ID';
const COLOUR_VAR = { been: '--accent', planned: '--warn' };
const FILL = { been: 0.45, planned: 0.36 };

function colour(kind) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(COLOUR_VAR[kind] || '--accent').trim();
  return v || '#a34f35';
}

/** A theme colour as red, green and blue, whatever form the stylesheet wrote it in. */
function rgbOf(kind) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = '#a34f35';
  ctx.fillStyle = colour(kind);
  const v = ctx.fillStyle;
  return v[0] === '#'
    ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16))
    : v.match(/[\d.]+/g).slice(0, 3).map(Number);
}

const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;
// The border is the fill's colour lifted towards white, so it reads against dark sea.
const lighter = (rgb) => rgb.map((c) => Math.round(c + (255 - c) * 0.55));

// A pin is the same pin while it is the same place of the same kind; anything
// else about it can change without the marker being replaced.
const keyOf = (p) => `${p.id}|${p.kind}|${p.lat}|${p.lng}`;
// A region is redrawn only when what it draws changes.
const regionKey = (r) => `${r.id}|${r.kind}|${r.filled}|${r.parts.length}`;

const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url} ${r.status}`))));

// Borders load once per visit, and only for a globe with somewhere to fill in.
let borders = null;
function loadBorders() {
  if (!borders) {
    borders = Promise.all([
      getJSON('/geo/countries-50m.json').then(prepareCountries),
      // Without the index the globe falls back to filling whole countries.
      getJSON('/geo/areas/index.json').catch(() => ({})),
    ]).catch((e) => { borders = null; throw e; });
  }
  return borders;
}

// A country's prefectures or states, fetched the first time a place needs them.
const areaFiles = new Map();
function loadAreas(code) {
  if (!areaFiles.has(code)) {
    areaFiles.set(code, getJSON(`/geo/areas/${code}.json`)
      .then((t) => prepareAreas(t, code))
      .catch(() => { areaFiles.delete(code); return []; }));
  }
  return areaFiles.get(code);
}

/**
 * The globe itself: Google's photorealistic 3D Earth, which zooms from space
 * to a street without changing renderer.
 *
 * Places are stamps (see globeStamp). Far out, the countries you have been to
 * and are going to are filled in, and their towns' stamps give way to them;
 * closer in the fill fades and the stamps come back. Journey ideas and places
 * you want to go stay stamps throughout: they are somewhere in particular, not
 * somewhere you have been.
 *
 * It needs WebGL and the Map Tiles API. Where either is missing it falls back
 * to the flat map at world zoom rather than a blank screen, and says so once.
 *
 * `aim` is a camera plus a key: a new key means fly there, even to the same
 * place again, which is what "show me the whole globe" pressed twice needs.
 */
export default function GlobeCanvas({ points, selectedId, aim, onSelect, onRegion }) {
  const host = useRef(null);
  const map3d = useRef(null);
  const map2d = useRef(null);
  const lib = useRef(null);
  const pins = useRef(new Map()); // key -> { id, kind, marker, stamp, shown?, remove }
  const shapes = useRef(new Map()); // regionKey -> { id, rgb, kind, elements, attached, remove }
  // Presses of the mouse or a finger on the globe, and the one that last chose something.
  const presses = useRef(0);
  const pressedAt = useRef(0);
  const chosenOn = useRef(-1);
  // How strongly regions show right now, from the camera's distance.
  const strength = useRef(1);
  const [mode, setMode] = useState(() => (googleMapsAvailable() ? '3d' : 'none'));
  const [ready, setReady] = useState(false);
  const [countries, setCountries] = useState(null);
  const [areaIndex, setAreaIndex] = useState(null);
  const [areasByCode, setAreasByCode] = useState({});

  const codes = useMemo(() => (areaIndex ? areaFilesFor(points, areaIndex) : []), [areaIndex, points]);
  const settled = !!areaIndex && codes.every((c) => areasByCode[c]);
  // Nothing is drawn until the areas are in, or a country would flash filled
  // and then empty again as its prefectures arrived.
  const regions = useMemo(() => (countries && settled
    ? regionsFor(points, countries, codes.flatMap((c) => areasByCode[c]))
    : []), [countries, settled, codes, areasByCode, points]);
  const covered = useMemo(() => new Set(regions.flatMap((r) => r.covered)), [regions]);

  const latest = useRef(null);
  latest.current = { onSelect, onRegion, aim, selectedId, regions, covered };

  const wantsRegions = points.some((p) => p.kind === 'been' || p.kind === 'planned');
  useEffect(() => {
    if (!ready || countries || !wantsRegions) return undefined;
    let live = true;
    // Without borders the globe still has its pins, which is what it had before.
    loadBorders().then(([c, index]) => {
      if (!live) return;
      setCountries(c);
      setAreaIndex(index);
    }).catch(() => {});
    return () => { live = false; };
  }, [ready, countries, wantsRegions]);

  useEffect(() => {
    const missing = codes.filter((c) => !areasByCode[c]);
    if (!missing.length) return undefined;
    let live = true;
    Promise.all(missing.map((c) => loadAreas(c).then((areas) => [c, areas]))).then((loaded) => {
      if (live) setAreasByCode((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
    });
    return () => { live = false; };
  }, [codes, areasByCode]);

  useEffect(() => {
    if (mode !== '3d') return undefined;
    let dead = false;
    let map = null;
    let frame = 0;
    const offs = [];
    const listen = (target, name, fn, options) => {
      target.addEventListener(name, fn, options);
      offs.push(() => target.removeEventListener(name, fn, options));
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
      strength.current = regionStrength(start.range);
      listen(map, 'gmp-error', fallback);
      listen(map, 'gmp-steadychange', (e) => { if (e.isSteady) clearTimeout(timer); });
      /*
       * A click on the ground closes the open place, but not the click that
       * opened it. The 3D map reports one press twice: the marker at once, then
       * the map a few hundred milliseconds later, once it has worked out where
       * on the Earth the press landed — by which time the camera is already
       * flying in, and the place it just opened was closed again. So a press
       * that chose a pin cannot also clear it; only a new press can.
       */
      listen(host.current, 'pointerup', () => { presses.current += 1; pressedAt.current = performance.now(); }, true);
      listen(map, 'gmp-click', (e) => {
        e.preventDefault();
        if (e.composedPath().some((n) => n.tagName === 'GMP-MARKER-INTERACTIVE')) return;
        if (presses.current === chosenOn.current) return;
        latest.current.onSelect(null);
      });
      // The camera's distance decides regions against pins; checked once a
      // frame at most, and acted on only when it crosses a step.
      listen(map, 'gmp-rangechange', () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const next = regionStrength(map.range);
          const crossed = next !== strength.current;
          strength.current = next;
          // Areas fade on their own sizes, so they are checked on every move;
          // only what changed step is repainted.
          paintRegions();
          if (crossed) placePins();
        });
      });
      host.current.append(map);
      map3d.current = map;
      setReady(true);
    }).catch(fallback);
    return () => {
      dead = true;
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
      offs.forEach((off) => off());
      if (map) map.remove(); // takes its markers and regions with it
      pins.current.clear();
      shapes.current.clear();
      map3d.current = null;
      setReady(false);
    };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
      shapes.current.forEach((entry) => entry.remove());
      shapes.current.clear();
      map2d.current = null;
      setReady(false);
      if (el) el.replaceChildren();
    };
  }, [mode]);

  /*
   * The selected stamp, drawn larger and straight, in place.
   *
   * Selection used to redraw every pin. A 3D marker added while the camera is
   * flying has to find the ground again, so each click made the whole globe's
   * pins blink out and back as it zoomed in. Now a click changes one stamp,
   * and a selected idea stops giving way to labels so it cannot be hidden on
   * the way down.
   */
  function restyle() {
    const selected = latest.current.selectedId;
    pins.current.forEach((entry) => {
      const on = entry.id === selected;
      entry.stamp.select(on);
      if (mode === '3d') {
        const collide = entry.kind === 'idea' && !on ? 'OPTIONAL_AND_HIDES_LOWER_PRIORITY' : 'REQUIRED';
        if (entry.marker.collisionBehavior !== collide) entry.marker.collisionBehavior = collide;
      } else {
        entry.marker.zIndex = on ? 1000 : entry.kind === 'idea' ? 1 : 10;
      }
    });
    raiseSelected();
  }

  /*
   * The globe draws markers in the order they were added, with no z-index to
   * say otherwise, so the chosen stamp is kept last, on top of any neighbour
   * it overlaps. That has to hold whenever stamps are added, not only when one
   * is chosen: choose the Kyoto journey from space and fly in, and the town
   * stamps that come back on the way down — Higashiyama Ward among them, a few
   * kilometres off — were added after it and covered it, so the stamp you
   * picked seemed to turn into another one.
   */
  function raiseSelected() {
    const map = map3d.current;
    if (!map) return;
    const { selectedId: selected } = latest.current;
    pins.current.forEach((entry) => {
      if (entry.id === selected && entry.shown && map.lastElementChild !== entry.marker) map.append(entry.marker);
    });
  }

  /*
   * Which pins are on the globe. Far out, a town in a filled-in country is
   * the country; the pin comes back as the fill fades. The selected place
   * always keeps its pin. Pins are only added and removed as the camera
   * crosses that line, never on every frame of a flight.
   */
  function placePins() {
    const map = map3d.current;
    if (!map) return;
    const { covered: hidden, selectedId: selected } = latest.current;
    let added = false;
    pins.current.forEach((entry) => {
      const want = entry.id === selected || strength.current < 1 || !hidden.has(entry.id);
      if (want && !entry.shown) { entry.stamp.wake(); map.append(entry.marker); entry.shown = true; added = true; }
      if (!want && entry.shown) { entry.marker.remove(); entry.shown = false; }
    });
    if (added) raiseSelected();
  }

  function add3D(L, p) {
    const marker = new L.MarkerInteractiveElement({
      position: { lat: p.lat, lng: p.lng },
      altitudeMode: 'CLAMP_TO_GROUND',
      // Ideas give way to your own places when they collide.
      collisionBehavior: p.kind === 'idea' ? 'OPTIONAL_AND_HIDES_LOWER_PRIORITY' : 'REQUIRED',
      title: p.name,
    });
    const stamp = createStamp(p);
    marker.append(stamp.el);
    marker.addEventListener('gmp-click', (e) => {
      e.stopPropagation();
      chosenOn.current = presses.current;
      latest.current.onSelect(p.id);
      // A marker clicked with the mouse or a finger keeps focus, and the globe
      // draws its keyboard outline as a white box round the stamp. Only a
      // pointer's click lets go of it; from the keyboard the outline stays.
      if (performance.now() - pressedAt.current < 800) setTimeout(() => marker.blur(), 0);
    });
    const entry = { id: p.id, kind: p.kind, marker, stamp, shown: false };
    entry.remove = () => { marker.remove(); entry.shown = false; };
    return entry;
  }

  function add2D(L, p) {
    const stamp = createStamp(p);
    stamp.wake();
    const marker = new L.AdvancedMarkerElement({
      map: map2d.current,
      position: { lat: p.lat, lng: p.lng },
      content: stamp.el,
      title: p.name,
      gmpClickable: true,
      zIndex: p.kind === 'idea' ? 1 : 10,
    });
    marker.addListener('click', () => latest.current.onSelect(p.id));
    return { id: p.id, kind: p.kind, marker, stamp, remove: () => { marker.map = null; } };
  }

  function chooseRegion(id) {
    // The map's late second report of a press can land on the prefecture under
    // the stamp just chosen; that press has made its choice already.
    if (presses.current === chosenOn.current) return;
    chosenOn.current = presses.current;
    const region = latest.current.regions.find((r) => r.id === id);
    if (region && latest.current.onRegion) latest.current.onRegion(region);
  }

  /*
   * Each region's fill and border at its current strength: a country's from
   * the camera's distance, an area's from how much of the view it fills. Gone
   * entirely, a region is taken off the globe too: an invisible one would
   * still catch clicks meant for the ground beneath it.
   *
   * The globe hands a click to whichever shape was added last, so areas are
   * kept after the country around them, or Japan's outline would take every
   * click meant for Kyoto.
   */
  function paintRegions() {
    const map = map3d.current;
    if (!map) return;
    const range = map.range;
    let countryAdded = false;
    shapes.current.forEach((entry) => {
      const k = entry.level === 'area' ? areaStrength(entry.size, range) : strength.current;
      if (k !== entry.k) {
        entry.k = k;
        const fill = entry.filled ? FILL[entry.kind] * k : 0;
        entry.elements.forEach((el) => {
          el.fillColor = rgba(entry.rgb, +fill.toFixed(3));
          el.strokeColor = rgba(lighter(entry.rgb), +(0.9 * k).toFixed(3));
        });
      }
      if (k > 0 && !entry.attached) {
        entry.elements.forEach((el) => map.append(el));
        entry.attached = true;
        if (entry.level === 'country') countryAdded = true;
      }
      if (k === 0 && entry.attached) { entry.elements.forEach((el) => el.remove()); entry.attached = false; }
    });
    if (countryAdded) {
      shapes.current.forEach((entry) => {
        if (entry.level === 'area' && entry.attached) entry.elements.forEach((el) => map.append(el));
      });
    }
  }

  function addRegion3D(L, r) {
    const rgb = rgbOf(r.kind);
    const elements = r.parts.map((part) => {
      const el = new L.Polygon3DInteractiveElement({
        outerCoordinates: part.outer.map(([lng, lat]) => ({ lat, lng })),
        // An empty list is refused outright, so a ring with no holes says nothing.
        ...(part.holes.length ? { innerCoordinates: part.holes.map((h) => h.map(([lng, lat]) => ({ lat, lng }))) } : {}),
        altitudeMode: 'CLAMP_TO_GROUND',
        // An outline alone has to carry the country, so it is drawn heavier.
        strokeWidth: r.filled ? 1.5 : 2,
      });
      el.addEventListener('gmp-click', (e) => {
        e.stopPropagation();
        chooseRegion(r.id);
      });
      return el;
    });
    const entry = {
      id: r.id, kind: r.kind, level: r.level, filled: r.filled, size: r.size, rgb, elements, attached: false, k: -1,
    };
    entry.remove = () => { elements.forEach((el) => el.remove()); entry.attached = false; };
    return entry;
  }

  function addRegion2D(L, r) {
    const rgb = rgbOf(r.kind);
    const polygon = new L.Polygon({
      map: map2d.current,
      paths: r.parts.flatMap((part) => [part.outer, ...part.holes]
        .map((ring) => ring.map(([lng, lat]) => ({ lat, lng })))),
      fillColor: rgba(rgb, 1),
      fillOpacity: r.filled ? FILL[r.kind] * 0.8 : 0,
      strokeColor: rgba(lighter(rgb), 1),
      strokeOpacity: 0.9,
      strokeWeight: r.filled ? 1 : 1.5,
      // Areas above their country, so a click on Kyoto is a click on Kyoto.
      zIndex: r.level === 'area' ? 1 : 0,
    });
    polygon.addListener('click', () => chooseRegion(r.id));
    return { id: r.id, kind: r.kind, remove: () => polygon.setMap(null) };
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
    placePins();
  }, [ready, mode, points]); // eslint-disable-line react-hooks/exhaustive-deps

  // The same for regions, which also decides which pins they stand in for.
  useEffect(() => {
    const L = lib.current;
    if (!ready || !L) return;
    if (mode === '3d' && !map3d.current) return;
    if (mode === '2d' && !map2d.current) return;
    const wanted = new Map(regions.map((r) => [regionKey(r), r]));
    shapes.current.forEach((entry, key) => {
      if (wanted.has(key)) return;
      entry.remove();
      shapes.current.delete(key);
    });
    wanted.forEach((r, key) => {
      if (!shapes.current.has(key)) shapes.current.set(key, mode === '3d' ? addRegion3D(L, r) : addRegion2D(L, r));
    });
    paintRegions();
    placePins();
  }, [ready, mode, regions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    restyle();
    placePins();
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
