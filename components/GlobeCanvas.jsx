'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { load3D, loadMaps, googleMapsAvailable, readScheme, dayColor } from '@/components/GoogleMap';
import {
  flightMillis, km, GROUNDED_RANGE, groundOffset, nextGroundAltitude, groundNear, offsetCamera,
} from '@/lib/globe';
import {
  prepareCountries, prepareAreas, areaFilesFor, regionsFor, regionStrength, areaStrength,
} from '@/lib/globeRegions';
import { rangeToZoom } from '@/lib/map3dCamera';
import { createMarker, createStop, thumbOf } from '@/components/globeMarker';
import { createMapPopup } from '@/lib/mapPopup';
import s from './Globe.module.css';

const MAP_ID = process.env.NEXT_PUBLIC_MAPS_MAP_ID || 'DEMO_MAP_ID';
const COLOUR_VAR = { been: '--accent', planned: '--warn' };
const FILL = { been: 0.45, planned: 0.36 };

function colour(kind) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(COLOUR_VAR[kind] || '--accent').trim();
  return v || '#a34f35';
}

/** Any CSS colour as red, green and blue, whatever form it was written in. */
function toRgb(css) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = '#a34f35';
  ctx.fillStyle = css;
  const v = ctx.fillStyle;
  return v[0] === '#'
    ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16))
    : v.match(/[\d.]+/g).slice(0, 3).map(Number);
}

const rgbOf = (kind) => toRgb(colour(kind));

const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;
// The border is the fill's colour lifted towards white, so it reads against dark sea.
const lighter = (rgb) => rgb.map((c) => Math.round(c + (255 - c) * 0.55));

// A pin is the same pin while it is the same place of the same kind with the
// same photograph and heart; a town whose photograph has just been found, or a
// trip just favourited, is redrawn.
const keyOf = (p) => `${p.id}|${p.kind}|${p.lat}|${p.lng}|${thumbOf(p) || ''}|${p.favourite ? 'fav' : ''}`;
// A region is redrawn only when what it draws changes.
const regionKey = (r) => `${r.id}|${r.kind}|${r.filled}|${r.parts.length}`;

/*
 * How far the camera is from what it looks at. The 3D map describes the same
 * view two ways: a point on the ground seen from 17,000 km, or a point 17,000
 * km up seen from 0 — and after some flights it switches to the second. Read
 * only the range, the globe from space measured 0 km, so it showed every town
 * and drew no regions. The distance is the two together.
 */
const distanceOf = (map) => (Number(map.range) || 0) + (Number(map.center && map.center.altitude) || 0);

// Where the camera is, to the metre: two the same a moment apart means it has stopped.
const spotOf = (map) => {
  const c = map.center || {};
  return [Number(c.lat).toFixed(5), Number(c.lng).toFixed(5), Math.round(c.altitude), Math.round(map.range), Math.round(map.tilt)].join(',');
};

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
 * Places are photographs (see globeMarker). Far out, the countries you have
 * been to and are going to are outlined and their areas filled, and their
 * towns' markers give way to them; closer in the markers come back. Journeys,
 * favourite or not, stay markers throughout: somewhere in particular, not
 * somewhere you have been.
 *
 * It needs WebGL and the Map Tiles API. Where either is missing it falls back
 * to the flat map at world zoom rather than a blank screen, and says so once.
 *
 * `aim` is a camera plus a key: a new key means fly there, even to the same
 * place again, which is what "show me the whole globe" pressed twice needs.
 */
export default function GlobeCanvas({
  points, selectedId, aim, onSelect, onRegion, onDrawn, route = null, insets = null,
  focus = false, stopIndex = null, hoverStop = null, stopCard = null, onStop, onStopHover,
}) {
  const host = useRef(null);
  const map3d = useRef(null);
  const map2d = useRef(null);
  const lib = useRef(null);
  const pins = useRef(new Map()); // key -> { id, kind, marker, face, shown?, remove }
  const shapes = useRef(new Map()); // regionKey -> { id, rgb, kind, elements, attached, remove }
  const routeDrawn = useRef([]); // the chosen trip's line and stops, to take away again
  const stopMarks = useRef([]); // [{ marker, face }] for the chosen route's stops, in order
  const callout = useRef(null); // takes the open stop's card off the map again
  // Ground heights the 3D map has reported where its view met the ground: [{ lat, lng, alt }].
  const ground = useRef([]);
  const flight = useRef(0); // counts camera flights, so a late check for an old one does nothing
  const touchedAt = useRef(0); // when the globe was last dragged, pinched or scrolled
  const correcting = useRef(false); // a correction onto the ground is flying right now
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
  latest.current = {
    onSelect, onRegion, onDrawn, aim, selectedId, regions, covered, focus, onStop, onStopHover, stopIndex, insets,
  };
  const drawn = () => { if (latest.current.onDrawn) latest.current.onDrawn(); };

  // With no maps at all there is nothing to wait for.
  useEffect(() => { if (mode === 'none') drawn(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
      strength.current = regionStrength(distanceOf(start));
      listen(map, 'gmp-error', fallback);
      // Steady for the first time means the Earth is on screen: the loader can go.
      listen(map, 'gmp-steadychange', (e) => { if (e.isSteady) { clearTimeout(timer); drawn(); } });
      /*
       * Steady is not the only proof. Choose a trip before the Earth has
       * finished loading and the camera sets off for street level, where every
       * tile is new: steady then comes long after the wait above, and a globe
       * that was plainly working turned flat under you. A flight that finished,
       * or a press the map could place on the ground, needs a working renderer too.
       */
      const working = () => clearTimeout(timer);
      listen(map, 'gmp-animationend', working);
      listen(map, 'gmp-click', working);
      // Wherever the camera comes to rest, how high the ground under the middle of the view is.
      listen(map, 'gmp-animationend', () => noteGround(map));
      listen(map, 'gmp-steadychange', (e) => { if (e.isSteady) noteGround(map); });
      /*
       * Your hand on the globe ends any correction onto the ground, including
       * one already flying: a correction that starts as you begin to zoom
       * would otherwise carry the view somewhere you did not scroll to.
       */
      const touched = () => {
        touchedAt.current = performance.now();
        if (!correcting.current) return;
        correcting.current = false;
        try { Promise.resolve(map.stopCameraAnimation && map.stopCameraAnimation()).catch(() => {}); } catch (e) { /* nothing flying */ }
      };
      listen(host.current, 'pointerdown', touched, true);
      listen(host.current, 'wheel', touched, { capture: true, passive: true });
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
        // A press on a pin, or on the card standing over one, is not a press on the ground.
        if (e.composedPath().some((n) => n.tagName === 'GMP-MARKER-INTERACTIVE' || n.tagName === 'GMP-POPOVER')) return;
        if (presses.current === chosenOn.current) return;
        latest.current.onSelect(null);
      });
      // The camera's distance decides regions against pins; checked once a
      // frame at most, and acted on only when it crosses a step. A camera held
      // as a point in the air moves its centre, not its range, as it zooms, so
      // both are listened to.
      const moved = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const next = regionStrength(distanceOf(map));
          const crossed = next !== strength.current;
          strength.current = next;
          // Areas fade on their own sizes, so they are checked on every move;
          // only what changed step is repainted.
          paintRegions();
          if (crossed) placePins();
        });
      };
      listen(map, 'gmp-rangechange', moved);
      listen(map, 'gmp-centerchange', moved);
      host.current.append(map);
      /*
       * Steady means every tile has arrived at full detail, which on a slow
       * connection can be half a minute after the Earth is plainly on screen.
       * The loader is for the empty stage, so it also goes a few seconds after
       * the globe starts drawing, whichever comes first.
       */
      const appeared = setTimeout(drawn, 6000);
      offs.push(() => clearTimeout(appeared));
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
      L.event.addListenerOnce(map, 'tilesloaded', drawn);
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
   * The selected marker, drawn larger, in place.
   *
   * Selection used to redraw every pin. A 3D marker added while the camera is
   * flying has to find the ground again, so each click made the whole globe's
   * pins blink out and back as it zoomed in. Now a click changes one marker,
   * and a selected idea stops giving way to labels so it cannot be hidden on
   * the way down.
   */
  function restyle() {
    const selected = latest.current.selectedId;
    pins.current.forEach((entry) => {
      const on = entry.id === selected;
      entry.face.select(on);
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
   * say otherwise, so the chosen marker is kept last, on top of any neighbour
   * it overlaps. That has to hold whenever markers are added, not only when one
   * is chosen: choose the Kyoto journey from space and fly in, and the town
   * markers that come back on the way down — Higashiyama Ward among them, a few
   * kilometres off — were added after it and covered it, so the marker you
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
    const { covered: hidden, selectedId: selected, focus: routeOpen } = latest.current;
    // With a trip's route open, its stops are the only markers: everything else steps aside.
    if (map2d.current) {
      pins.current.forEach((entry) => {
        const want = !routeOpen;
        if (entry.shown !== want) { entry.marker.map = want ? map2d.current : null; entry.shown = want; }
      });
      return;
    }
    const map = map3d.current;
    if (!map) return;
    let added = false;
    pins.current.forEach((entry) => {
      const want = !routeOpen && (entry.id === selected || strength.current < 1 || !hidden.has(entry.id));
      if (want && !entry.shown) { entry.face.wake(); map.append(entry.marker); entry.shown = true; added = true; }
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
      // A circle sits centred on its place; its name is the app's tooltip, not the system's.
      anchorLeft: '-50%',
      anchorTop: '-50%',
    });
    const face = createMarker(p);
    marker.append(face.el);
    marker.addEventListener('gmp-click', (e) => {
      e.stopPropagation();
      chosenOn.current = presses.current;
      latest.current.onSelect(p.id);
      // A marker clicked with the mouse or a finger keeps focus, and the globe
      // draws its keyboard outline as a white box round the marker. Only a
      // pointer's click lets go of it; from the keyboard the outline stays.
      if (performance.now() - pressedAt.current < 800) setTimeout(() => marker.blur(), 0);
    });
    const entry = { id: p.id, kind: p.kind, marker, face, shown: false };
    entry.remove = () => { marker.remove(); entry.shown = false; };
    return entry;
  }

  function add2D(L, p) {
    const face = createMarker(p, { lift: true });
    face.wake();
    const marker = new L.AdvancedMarkerElement({
      map: map2d.current,
      position: { lat: p.lat, lng: p.lng },
      content: face.el,
      gmpClickable: true,
      zIndex: p.kind === 'idea' ? 1 : 10,
    });
    marker.addListener('click', () => latest.current.onSelect(p.id));
    return { id: p.id, kind: p.kind, marker, face, shown: true, remove: () => { marker.map = null; } };
  }

  function chooseRegion(id) {
    // The map's late second report of a press can land on the prefecture under
    // the marker just chosen; that press has made its choice already.
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
    const range = distanceOf(map);
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

  /*
   * The chosen trip's or journey's route: a line from stop to stop, a new
   * colour for each day, and every stop numbered in order — the same colours
   * the trip's own map gives its days, walking round the hue circle, so the
   * route reads as progress. Drawn above the regions and under the
   * photographs, and gone as soon as nothing is chosen.
   */
  useEffect(() => {
    const L = lib.current;
    routeDrawn.current.forEach((clear) => clear());
    routeDrawn.current = [];
    stopMarks.current = [];
    if (!ready || !L || !route || !route.stops.length) return undefined;
    const hover = (i) => (on) => { if (latest.current.onStopHover) latest.current.onStopHover(on ? i : null); };
    const choose = (i) => { if (latest.current.onStop) latest.current.onStop(i); };
    const total = Math.max(1, ...route.stops.map((s) => s.section + 1));
    const tone = (section) => `rgb(${toRgb(dayColor(section, total)).join(', ')})`;
    if (mode === '3d' && map3d.current) {
      const map = map3d.current;
      route.legs.forEach((leg) => {
        const line = new L.Polyline3DElement({
          coordinates: leg.points.map((p) => ({ lat: p.lat, lng: p.lng })),
          altitudeMode: 'CLAMP_TO_GROUND',
          strokeColor: tone(leg.section),
          strokeWidth: 5,
          outerColor: 'rgba(255, 255, 255, 0.9)',
          outerWidth: 0.45,
          // A hop between cities follows the Earth's curve, not a straight cut through it.
          geodesic: true,
          drawsOccludedSegments: false,
          zIndex: 5,
        });
        map.append(line);
        routeDrawn.current.push(() => line.remove());
      });
      route.stops.forEach((stop, i) => {
        // Every stop shows, crowded or not: with the trip open they are what you came to see.
        const marker = new L.MarkerInteractiveElement({
          position: { lat: stop.lat, lng: stop.lng },
          altitudeMode: 'CLAMP_TO_GROUND',
          collisionBehavior: 'REQUIRED',
          // Centred on the spot, where the line passes, rather than standing above it.
          anchorLeft: '-50%',
          anchorTop: '-50%',
        });
        const face = createStop(stop, tone(stop.section), { onHover: hover(i) });
        marker.append(face.el);
        marker.addEventListener('gmp-click', (e) => {
          e.stopPropagation();
          chosenOn.current = presses.current;
          choose(i);
          if (performance.now() - pressedAt.current < 800) setTimeout(() => marker.blur(), 0);
        });
        map.append(marker);
        stopMarks.current.push({ marker, face });
        routeDrawn.current.push(() => marker.remove());
      });
      // Stops were added after the photographs; the chosen one goes back on top.
      raiseSelected();
    } else if (mode === '2d' && map2d.current) {
      const map = map2d.current;
      route.legs.forEach((leg) => {
        const line = new L.Polyline({
          map,
          path: leg.points.map((p) => ({ lat: p.lat, lng: p.lng })),
          geodesic: true,
          strokeColor: tone(leg.section),
          strokeOpacity: 1,
          strokeWeight: 4,
          zIndex: 5,
        });
        routeDrawn.current.push(() => line.setMap(null));
      });
      route.stops.forEach((stop, i) => {
        const face = createStop(stop, tone(stop.section), { lift: true, onHover: hover(i) });
        const marker = new L.AdvancedMarkerElement({
          map,
          position: { lat: stop.lat, lng: stop.lng },
          content: face.el,
          gmpClickable: true,
          zIndex: 50 + i,
        });
        marker.addListener('click', () => choose(i));
        stopMarks.current.push({ marker, face });
        routeDrawn.current.push(() => { marker.map = null; });
      });
    }
    return undefined;
  }, [ready, mode, route && route.key, route && route.stops.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { routeDrawn.current.forEach((clear) => clear()); routeDrawn.current = []; }, []);

  // Opening or closing a route hides or brings back every other marker.
  useEffect(() => { if (ready) placePins(); }, [ready, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * The chosen stop and the one under a pointer — on the globe or in the
   * itinerary beside it — drawn the way the trip map draws them: the chosen
   * one a little larger, the pointed-at one larger still with a halo, and the
   * chosen one moved last so nothing near it covers it.
   */
  useEffect(() => {
    stopMarks.current.forEach(({ face }, i) => face.set({ active: i === stopIndex, hover: i === hoverStop }));
  }, [stopIndex, hoverStop, route && route.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const chosen = stopIndex != null && stopMarks.current[stopIndex];
    if (chosen && map3d.current) map3d.current.append(chosen.marker);
  }, [stopIndex, route && route.key]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * The chosen stop's card, standing over its pin the way the trip map's does:
   * the same card, from the same builder. On the 3D globe it is the map's own
   * popover, anchored to the pin so it rides along as the camera flies in; on
   * the flat map, Google's info window, as on the trip map. Closed by its ✕,
   * by choosing the pin again, by a press on the ground or by Escape.
   */
  useEffect(() => {
    if (callout.current) { callout.current(); callout.current = null; }
    const L = lib.current;
    const chosen = ready && L && stopCard && stopIndex != null && stopMarks.current[stopIndex];
    if (!chosen) return undefined;
    const content = createMapPopup(stopCard, { onClose: stopCard.onClose, onPhoto: stopCard.onPhoto });
    if (mode === '3d' && map3d.current && L.PopoverElement) {
      const pop = new L.PopoverElement({
        positionAnchor: chosen.marker,
        open: true,
        // The globe closes it itself, so a press that lands on the ground can
        // tell a stop's card from the trip it belongs to.
        lightDismissDisabled: true,
        // The camera is already flying to the stop; the card is not to pull it elsewhere.
        autoPanDisabled: true,
      });
      pop.className = s.callout;
      // It takes focus as it opens and keeps Escape to itself, so the page never hears it.
      pop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && stopCard.onClose) { e.preventDefault(); stopCard.onClose(); }
      }, true);
      pop.append(content);
      map3d.current.append(pop);
      callout.current = () => pop.remove();
    } else if (mode === '2d' && map2d.current) {
      const info = new L.InfoWindow({ maxWidth: 268, headerDisabled: true });
      info.setContent(content);
      info.open({ map: map2d.current, anchor: chosen.marker });
      callout.current = () => info.close();
    }
    return undefined;
  }, [ready, mode, stopCard && stopCard.key, stopIndex, route && route.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (callout.current) callout.current(); }, []);

  function rememberGround(sample) {
    ground.current = [sample, ...ground.current.filter((s) => km(s, sample) > 0.05)].slice(0, 80);
  }

  // The map's centre is where its view meets the ground only while the camera
  // looks at the ground from a distance; far out it holds the camera as a point
  // in the air instead, with no range, and that height is not the ground's.
  function reportedGround(map) {
    const c = map.center;
    const range = Number(map.range);
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.altitude)) return null;
    if (!(range > 5 && range < 60000) || c.altitude < -450 || c.altitude > 8900) return null;
    return { lat: c.lat, lng: c.lng, alt: c.altitude };
  }

  function noteGround(map) {
    const seen = reportedGround(map);
    if (seen) rememberGround(seen);
  }

  /*
   * Calls `go` once the camera has come to rest after a flight: its end
   * reported, the camera no longer where it set off from (a flight stopped to
   * make way for this one reports an end as well), and the view holding still
   * for a moment, since the ground under it sharpens as its tiles load and
   * moves where the map says its view meets it.
   */
  function whenLanded(map, id, from, duration, go) {
    const began = performance.now();
    let done = false;
    let giveUp = 0;
    const settle = (last, waited = 0) => setTimeout(() => {
      if (flight.current !== id) return;
      const at = spotOf(map);
      if (at !== last && waited < 6) settle(at, waited + 1);
      else go();
    }, 300);
    const ended = () => {
      if (done) return;
      if (flight.current !== id) { finish(); return; }
      if (performance.now() - began < duration * 0.6 || spotOf(map) === from) return;
      finish();
      settle(spotOf(map));
    };
    function finish() {
      done = true;
      map.removeEventListener('gmp-animationend', ended);
      clearTimeout(giveUp);
    }
    if (!duration) { settle(spotOf(map)); return; }
    map.addEventListener('gmp-animationend', ended);
    giveUp = setTimeout(finish, duration + 8000);
  }

  /*
   * Once a close view lands, check it landed on its target and, if the ground
   * there is higher or lower than it was aimed at, move in by what it missed:
   * at most twice, quickly, and never once the globe has been touched.
   */
  function settleOnGround(map, id, cam, startedAt, from, ms) {
    const tries = [];
    let current = cam;
    const quick = window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof map.flyCameraTo !== 'function' ? 0 : 700;
    const check = () => {
      if (flight.current !== id || touchedAt.current > startedAt) return;
      const seen = reportedGround(map);
      if (!seen) return;
      const target = current.center;
      const missed = km(seen, target) * 1000;
      if (missed <= Math.max(60, current.range * 0.06)) {
        rememberGround({ lat: target.lat, lng: target.lng, alt: target.altitude || 0 });
        return;
      }
      // Too far off to be this flight's view, or tried enough: leave it where it is.
      if (tries.length >= 2 || missed > current.range * 3 + 3000) return;
      tries.push({ alt: target.altitude || 0, off: groundOffset(target, seen, current.heading || 0) });
      current = { ...current, center: { ...target, altitude: nextGroundAltitude(tries, current.tilt || 0) } };
      const before = spotOf(map);
      if (!quick) {
        Object.assign(map, current);
      } else {
        correcting.current = true;
        try {
          Promise.resolve(map.flyCameraTo({ endCamera: current, durationMillis: quick })).catch(() => {});
        } catch (e) {
          Object.assign(map, current);
        }
      }
      whenLanded(map, id, before, quick, () => { correcting.current = false; check(); });
    };
    whenLanded(map, id, from, ms, check);
  }

  useEffect(() => {
    if (!ready || !aim) return;
    /*
     * Aimed around whatever is laid over the globe: on a phone an open trip's
     * card is a sheet across the foot of the screen, and a camera aimed at the
     * middle would put the trip's markers behind it (lib/globe, offsetCamera).
     */
    const box = host.current;
    let cam = offsetCamera(aim.camera, insets && insets(), box ? box.clientHeight : 0);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (mode === '3d' && map3d.current) {
      const map = map3d.current;
      // Moving to a place keeps you as close as you are, if that is closer.
      const now = distanceOf(map);
      /*
       * Moving to a place keeps you as close as you are, if that is closer —
       * but only when the place is already in view. Choosing the Kyoto journey
       * while at street level in Tokyo, 400 km away, would otherwise land at
       * street level somewhere in the middle of it and show none of its route.
       */
      const inView = map.center && km(map.center, cam.center) < (now / 1000) * 0.6;
      if (aim.closerOnly && now < cam.range && inView) cam = { ...cam, range: now };
      // A close view aims at the height of the ground there, as far as it is known.
      const grounded = cam.range <= GROUNDED_RANGE;
      if (grounded) {
        cam = { ...cam, center: { lat: cam.center.lat, lng: cam.center.lng, altitude: groundNear(ground.current, cam.center) } };
      }
      const ms = aim.instant || still ? 0 : flightMillis({ center: map.center, range: now }, cam);
      const id = ++flight.current;
      correcting.current = false;
      const startedAt = performance.now();
      const from = spotOf(map);
      try { Promise.resolve(map.stopCameraAnimation && map.stopCameraAnimation()).catch(() => {}); } catch (e) { /* nothing flying */ }
      if (!ms || typeof map.flyCameraTo !== 'function') {
        Object.assign(map, cam);
      } else {
        try {
          Promise.resolve(map.flyCameraTo({ endCamera: cam, durationMillis: ms })).catch(() => Object.assign(map, cam));
        } catch (e) {
          Object.assign(map, cam);
        }
      }
      if (grounded) settleOnGround(map, id, cam, startedAt, from, typeof map.flyCameraTo === 'function' ? ms : 0);
    } else if (mode === '2d' && map2d.current) {
      const h = host.current ? host.current.clientHeight : 600;
      const zoom = Math.round(rangeToZoom(cam.range, cam.center.lat, h));
      map2d.current.panTo(cam.center);
      map2d.current.setZoom(aim.closerOnly ? Math.max(zoom, map2d.current.getZoom()) : zoom);
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
