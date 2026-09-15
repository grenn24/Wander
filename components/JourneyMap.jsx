'use client';
import { useEffect, useRef, useState } from 'react';
import { loadMaps, useMapScheme } from '@/components/GoogleMap';
import { boundsOf, fitZoom, pointAlong, spanKm } from '@/lib/journeyMap';
import s from './Journeys.module.css';

const MAP_ID = process.env.NEXT_PUBLIC_MAPS_MAP_ID || 'DEMO_MAP_ID';
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

/**
 * The journey's route, drawn as the reader goes.
 *
 * Every stop is a numbered pin and the whole way is a faint dashed line; the
 * part already read is drawn solid, ending in a dot between the last stop
 * named and the next. Reaching a new section flies the camera to its stops.
 * Colour scheme is fixed when a Google map is built, so a theme change builds
 * a new one.
 */
export default function JourneyMap(props) {
  const scheme = useMapScheme();
  return <RouteMap key={scheme} scheme={scheme} {...props} />;
}

function RouteMap({ scheme, route, sections, where, dropped, hover, onPin }) {
  const el = useRef(null);
  const map = useRef(null);
  const pins = useRef([]);
  const done = useRef(null);
  const head = useRef(null);
  const frame = useRef(0);
  const pinned = useRef(onPin);
  pinned.current = onPin;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    const lines = [];
    loadMaps().then((L) => {
      if (dead || !el.current) return;
      const R = window.google.maps.RenderingType;
      const m = new L.Map(el.current, {
        mapId: MAP_ID,
        colorScheme: scheme,
        center: { lat: route[0].lat, lng: route[0].lng },
        zoom: 5,
        disableDefaultUI: true,
        clickableIcons: false,
        // The page scrolls under the wheel; the map needs ctrl or two fingers.
        gestureHandling: 'cooperative',
        // Vector maps take fractional zoom, which is what makes the glide smooth.
        ...(R ? { renderingType: R.VECTOR } : {}),
      });
      map.current = m;
      const path = route.map(({ lat, lng }) => ({ lat, lng }));
      lines.push(new L.Polyline({
        map: m, path, strokeOpacity: 0, strokeColor: cssVar('--text-3', '#8d8377'),
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, scale: 2.5 }, offset: '0', repeat: '9px' }],
      }));
      done.current = new L.Polyline({
        map: m, path: [], strokeColor: cssVar('--accent', '#a34f35'), strokeOpacity: 0.95, strokeWeight: 4,
      });
      lines.push(done.current);
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
      head.current = new L.AdvancedMarkerElement({ position: path[0], content: dot, zIndex: 2000 });
      setReady(true);
    }).catch(() => { if (!dead) setFailed(true); });
    return () => {
      dead = true;
      cancelAnimationFrame(frame.current);
      pins.current.forEach((p) => { p.mark.map = null; });
      lines.forEach((l) => l.setMap(null));
      if (head.current) head.current.map = null;
      if (map.current) window.google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
    };
    // Built once per scheme; everything after is an update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fly(points, tries = 0) {
    const m = map.current;
    const box = el.current;
    if (!m || !box) return;
    if (!box.clientWidth || !box.clientHeight) {
      if (tries < 20) frame.current = requestAnimationFrame(() => fly(points, tries + 1));
      return;
    }
    const b = boundsOf(points);
    const zoom = fitZoom(b, box.clientWidth, box.clientHeight, { pad: 64, max: points.length > 1 ? 12 : 10 });
    const to = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
    cancelAnimationFrame(frame.current);
    const c = m.getCenter();
    const from = { lat: c.lat(), lng: c.lng(), zoom: m.getZoom() };
    if (still() || !Number.isFinite(from.zoom)) { m.moveCamera({ center: to, zoom }); return; }
    // Out, across and back in: gliding a long way at close zoom smears the
    // ground past too fast to follow.
    const low = Math.min(from.zoom, zoom) - (spanKm(from, to) > 120 ? 1.2 : 0);
    const start = performance.now();
    const ms = 1300;
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = ease(t);
      const z = t < 0.5
        ? from.zoom + (low - from.zoom) * ease(t * 2)
        : low + (zoom - low) * ease((t - 0.5) * 2);
      m.moveCamera({ center: { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e }, zoom: z });
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }

  // A new section: fly to its stops, or to the whole route if it names none.
  useEffect(() => {
    if (!ready) return;
    const ids = new Set((sections[where.section] || {}).places || []);
    const points = route.filter((st) => ids.has(st.id));
    fly(points.length ? points : route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, where.section]);

  // The way read so far, and the dot at the end of it.
  useEffect(() => {
    if (!ready || !done.current) return;
    const { index, t } = where;
    if (index < 0) {
      done.current.setPath([]);
      head.current.map = null;
      return;
    }
    const path = route.slice(0, index + 1).map(({ lat, lng }) => ({ lat, lng }));
    const tip = index < route.length - 1 && t > 0 ? pointAlong(route[index], route[index + 1], t) : path[path.length - 1];
    if (tip !== path[path.length - 1]) path.push(tip);
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
