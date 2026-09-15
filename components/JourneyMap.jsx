'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadMaps } from '@/components/GoogleMap';
import { boundsOf, fitZoom, pointAlong, spanKm } from '@/lib/journeyMap';
import s from './Journeys.module.css';

const MAP_ID = process.env.NEXT_PUBLIC_MAPS_MAP_ID || 'DEMO_MAP_ID';
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = () => !!(navigator.connection && navigator.connection.saveData);
const plain = (points) => points.map(({ lat, lng }) => ({ lat, lng }));
// What shows before imagery arrives: dark, like the imagery, not Google's pale grey.
const GROUND = '#24261f';
// How many views ahead of the reader to load in advance.
const AHEAD = 5;

/**
 * The journey's route over satellite imagery, drawn as the reader goes.
 *
 * Every stop is a numbered pin and the whole way is a dashed white line; the
 * part already read is drawn solid over a white casing, ending in a dot
 * between the last stop named and the next. The camera frames what is being
 * read, and an unseen copy of the map visits the next few views first, so the
 * imagery is already in the browser when the camera gets there.
 */
export default function JourneyMap({ route, sections, where, dropped, hover, onPin }) {
  const el = useRef(null);
  const ghostEl = useRef(null);
  const map = useRef(null);
  const ghost = useRef(null);
  const pins = useRef([]);
  const casing = useRef(null);
  const done = useRef(null);
  const head = useRef(null);
  const frame = useRef(0);
  const flight = useRef(0);
  const warm = useRef({ queue: [], seen: new Set(), busy: false, timer: 0 });
  const pinned = useRef(onPin);
  pinned.current = onPin;
  const [ready, setReady] = useState(false);
  const [warming, setWarming] = useState(false);
  const [failed, setFailed] = useState(false);

  // Every view the camera will take, in reading order: each section as a
  // whole, then each stop in it.
  const steps = useMemo(() => {
    const out = [];
    sections.forEach((sec, section) => {
      out.push({ section, index: -1 });
      route.forEach((st, index) => { if (st.section === section) out.push({ section, index }); });
    });
    return out;
  }, [route, sections]);

  /*
   * What the camera frames: the stop being read and the next one in the same
   * section, or the whole section before its first stop comes up. A section
   * that names no stop falls back to the whole route.
   */
  function pointsFor(section, index) {
    const here = (st) => st && st.section === section;
    if (index >= 0 && here(route[index])) return [route[index], ...(here(route[index + 1]) ? [route[index + 1]] : [])];
    const ids = new Set((sections[section] || {}).places || []);
    const points = route.filter((st) => ids.has(st.id));
    return points.length ? points : route;
  }

  // Street level for a stop on its own, a little wider for a pair or a section.
  function cameraFor(points) {
    const box = el.current;
    const b = boundsOf(points);
    const zoom = Math.floor(fitZoom(b, box.clientWidth, box.clientHeight, { pad: 72, max: points.length > 1 ? 16 : 15 }));
    return { center: { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 }, zoom };
  }

  useEffect(() => {
    let dead = false;
    const lines = [];
    loadMaps().then((L) => {
      if (dead || !el.current) return;
      const options = {
        mapId: MAP_ID,
        mapTypeId: 'hybrid',
        center: { lat: route[0].lat, lng: route[0].lng },
        zoom: 5,
        disableDefaultUI: true,
        clickableIcons: false,
        backgroundColor: GROUND,
      };
      // The page scrolls under the wheel; the map needs ctrl or two fingers.
      const m = new L.Map(el.current, { ...options, gestureHandling: 'cooperative' });
      map.current = m;
      lines.push(new L.Polyline({
        map: m, path: plain(route), strokeOpacity: 0, strokeColor: '#ffffff', zIndex: 1,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.85, scale: 2.5 }, offset: '0', repeat: '9px' }],
      }));
      casing.current = new L.Polyline({ map: m, path: [], strokeColor: '#ffffff', strokeOpacity: 0.95, strokeWeight: 8, zIndex: 2 });
      done.current = new L.Polyline({
        map: m, path: [], strokeColor: cssVar('--accent', '#a34f35'), strokeOpacity: 1, strokeWeight: 4, zIndex: 3,
      });
      lines.push(casing.current, done.current);
      pins.current = route.map((st, i) => {
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = s.pin;
        pin.textContent = String(i + 1);
        pin.setAttribute('aria-label', `${i + 1}. ${st.name}: show it in the journal`);
        const mark = new L.AdvancedMarkerElement({ map: m, position: { lat: st.lat, lng: st.lng }, content: pin, zIndex: i + 1 });
        mark.addListener('click', () => pinned.current(st.id));
        return { id: st.id, mark, pin };
      });
      const dot = document.createElement('div');
      dot.className = s.traveller;
      head.current = new L.AdvancedMarkerElement({ position: plain(route)[0], content: dot, zIndex: 2000 });
      setReady(true);

      // The unseen copy starts once the first view has loaded, so it never
      // competes with what the reader is looking at. Not on a data saver.
      window.google.maps.event.addListenerOnce(m, 'tilesloaded', () => {
        if (dead || !ghostEl.current || saveData()) return;
        ghost.current = new L.Map(ghostEl.current, { ...options, gestureHandling: 'none', keyboardShortcuts: false });
        setWarming(true);
      });
    }).catch(() => { if (!dead) setFailed(true); });
    return () => {
      dead = true;
      flight.current += 1;
      cancelAnimationFrame(frame.current);
      clearTimeout(warm.current.timer);
      warm.current.queue = [];
      pins.current.forEach((p) => { p.mark.map = null; });
      lines.forEach((l) => l.setMap(null));
      if (head.current) head.current.map = null;
      [map.current, ghost.current].forEach((x) => { if (x) window.google.maps.event.clearInstanceListeners(x); });
      map.current = null;
      ghost.current = null;
    };
    // Built once; everything after is an update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Show the unseen map one queued view at a time, each until its imagery has loaded. */
  function warmNext() {
    const w = warm.current;
    const g = ghost.current;
    if (w.busy || !g) return;
    const job = w.queue.shift();
    if (!job) return;
    w.busy = true;
    let listener = null;
    const next = () => {
      clearTimeout(w.timer);
      if (listener) listener.remove();
      w.busy = false;
      warmNext();
    };
    listener = window.google.maps.event.addListenerOnce(g, 'tilesloaded', next);
    w.timer = setTimeout(next, 4000);
    g.moveCamera(job);
  }

  /*
   * Queue the next few views after the reader's position: each at its own
   * zoom and one level out, which is what the camera passes through on the
   * way in. A view already loaded is never queued twice.
   */
  useEffect(() => {
    if (!ready || !warming || !el.current || !el.current.clientWidth) return;
    const { section, index } = where;
    const inSection = index >= 0 && route[index] && route[index].section === section;
    const at = Math.max(0, steps.findIndex((st) => st.section === section && st.index === (inSection ? index : -1)));
    const w = warm.current;
    const queue = (step) => {
      const cam = cameraFor(pointsFor(step.section, step.index));
      [cam.zoom, cam.zoom - 1].forEach((zoom) => {
        const key = `${cam.center.lat.toFixed(4)},${cam.center.lng.toFixed(4)},${zoom}`;
        if (w.seen.has(key)) return;
        w.seen.add(key);
        w.queue.push({ center: cam.center, zoom });
      });
    };
    steps.slice(at, at + AHEAD).forEach(queue);
    // A new section is where the camera travels furthest, and where a quick
    // skim lands, so every section's opening view follows the nearest ones.
    if (!w.primed) {
      w.primed = true;
      steps.filter((step) => step.index === -1).forEach(queue);
    }
    warmNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, warming, where.section, where.index, steps]);

  /*
   * Satellite imagery comes only in whole zoom levels, so the glide is
   * Google's own animation in steps: out a level if the next stops are far,
   * across, then in. Each step waits for the map to settle, and a newer
   * flight abandons an older one mid-way.
   */
  function fly(points, tries = 0) {
    const m = map.current;
    const box = el.current;
    if (!m || !box) return;
    if (!box.clientWidth || !box.clientHeight) {
      if (tries < 20) frame.current = requestAnimationFrame(() => fly(points, tries + 1));
      return;
    }
    const { center: to, zoom } = cameraFor(points);
    const trip = flight.current + 1;
    flight.current = trip;
    const c = m.getCenter();
    const from = { lat: c.lat(), lng: c.lng() };
    const now = m.getZoom();
    if (still() || !Number.isFinite(now)) { m.moveCamera({ center: to, zoom }); return; }
    const settle = (fn) => window.google.maps.event.addListenerOnce(m, 'idle', () => { if (trip === flight.current) fn(); });
    const land = () => { if (m.getZoom() !== zoom) m.setZoom(zoom); };
    const across = () => {
      if (spanKm(from, to) < 0.5) { land(); return; }
      m.panTo(to);
      settle(land);
    };
    const low = Math.min(now, zoom) - (spanKm(from, to) > 120 ? 1 : 0);
    if (now > low) { m.setZoom(low); settle(across); } else across();
  }

  useEffect(() => {
    if (!ready) return;
    fly(pointsFor(where.section, where.index));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, where.section, where.index]);

  // The way read so far, and the dot at the end of it.
  useEffect(() => {
    if (!ready || !done.current) return;
    const { index, t } = where;
    if (index < 0) {
      casing.current.setPath([]);
      done.current.setPath([]);
      head.current.map = null;
      return;
    }
    const path = plain(route.slice(0, index + 1));
    const tip = index < route.length - 1 && t > 0 ? pointAlong(route[index], route[index + 1], t) : path[path.length - 1];
    if (tip !== path[path.length - 1]) path.push(tip);
    casing.current.setPath(path);
    done.current.setPath(path);
    head.current.position = tip;
    head.current.map = map.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, where.index, where.t]);

  // Pins say which section you are in, what you have passed, and what you left out.
  useEffect(() => {
    if (!ready) return;
    const active = new Set((sections[where.section] || {}).places || []);
    pins.current.forEach((p, i) => {
      const flag = (name, on) => (on ? p.pin.setAttribute(name, '') : p.pin.removeAttribute(name));
      flag('data-active', active.has(p.id));
      flag('data-visited', i <= where.index);
      flag('data-off', dropped.has(p.id));
      flag('data-hover', hover === p.id);
      p.mark.zIndex = hover === p.id ? 1500 : active.has(p.id) ? 500 + i : i + 1;
    });
  }, [ready, sections, where.section, where.index, dropped, hover]);

  return (
    <>
      <div ref={ghostEl} className={s.mapGhost} aria-hidden="true" />
      <div ref={el} className={s.mapCanvas} />
      {failed ? <p className={s.mapFail}>The map could not load.</p> : null}
    </>
  );
}
