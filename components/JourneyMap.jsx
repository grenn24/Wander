'use client';
import { useEffect, useRef, useState } from 'react';
import { loadMaps } from '@/components/GoogleMap';
import { boundsOf, fitZoom, pointAlong, spanKm } from '@/lib/journeyMap';
import s from './Journeys.module.css';

const MAP_ID = process.env.NEXT_PUBLIC_MAPS_MAP_ID || 'DEMO_MAP_ID';
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const plain = (points) => points.map(({ lat, lng }) => ({ lat, lng }));

/**
 * The journey's route over satellite imagery, drawn as the reader goes.
 *
 * Every stop is a numbered pin and the whole way is a dashed white line; the
 * part already read is drawn solid over a white casing, so it holds up on
 * desert and forest alike, ending in a dot between the last stop named and
 * the next. Reaching a new section flies the camera to its stops.
 */
export default function JourneyMap({ route, sections, where, dropped, hover, onPin }) {
  const el = useRef(null);
  const map = useRef(null);
  const pins = useRef([]);
  const casing = useRef(null);
  const done = useRef(null);
  const head = useRef(null);
  const frame = useRef(0);
  const flight = useRef(0);
  const pinned = useRef(onPin);
  pinned.current = onPin;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    const lines = [];
    loadMaps().then((L) => {
      if (dead || !el.current) return;
      const m = new L.Map(el.current, {
        mapId: MAP_ID,
        mapTypeId: 'hybrid',
        center: { lat: route[0].lat, lng: route[0].lng },
        zoom: 5,
        disableDefaultUI: true,
        clickableIcons: false,
        // The page scrolls under the wheel; the map needs ctrl or two fingers.
        gestureHandling: 'cooperative',
      });
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
    }).catch(() => { if (!dead) setFailed(true); });
    return () => {
      dead = true;
      flight.current += 1;
      cancelAnimationFrame(frame.current);
      pins.current.forEach((p) => { p.mark.map = null; });
      lines.forEach((l) => l.setMap(null));
      if (head.current) head.current.map = null;
      if (map.current) window.google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
    };
    // Built once; everything after is an update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const b = boundsOf(points);
    // Street level for a stop on its own, a little wider for a pair or a section.
    const zoom = Math.floor(fitZoom(b, box.clientWidth, box.clientHeight, { pad: 72, max: points.length > 1 ? 16 : 15 }));
    const to = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
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

  /*
   * The camera frames what is being read: the stop the reader is on and the
   * next one in the same section, close enough to tell one street from the
   * next, or the whole section before its first stop comes up. A section
   * that names no stop falls back to the whole route.
   */
  useEffect(() => {
    if (!ready) return;
    const { section, index } = where;
    const here = (st) => st && st.section === section;
    let points;
    if (index >= 0 && here(route[index])) {
      points = [route[index], ...(here(route[index + 1]) ? [route[index + 1]] : [])];
    } else {
      const ids = new Set((sections[section] || {}).places || []);
      points = route.filter((st) => ids.has(st.id));
    }
    fly(points.length ? points : route);
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
      <div ref={el} className={s.mapCanvas} />
      {failed ? <p className={s.mapFail}>The map could not load.</p> : null}
    </>
  );
}
