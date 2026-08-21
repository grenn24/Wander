'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass, MapPinOff, Loader2, Plus, Navigation, X, Footprints, TrainFront, TriangleAlert,
} from 'lucide-react';
import { categoryOf, fmtDayTiny, fmtTime, sortActs } from '@/lib/util';
import { categoryIcon } from '@/lib/icons';
import {
  geocodeBest, reverseGeocode, nearby, haversine, fmtKm, walkMinutes, NEARBY_KINDS,
} from '@/lib/geo';

const CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

const CAT_VAR = {
  sightseeing: 1, food: 2, transport: 3, lodging: 4, activity: 5, shopping: 6, other: 7,
};

function catColor(id) {
  if (typeof document === 'undefined') return '#2a78d6';
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(`--cat-${CAT_VAR[id] || 7}`).trim();
  return v || '#2a78d6';
}

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('no window')); return; }
    if (window.L) { resolve(window.L); return; }
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = CSS_URL; link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    let s = document.querySelector('script[data-leaflet]');
    if (!s) {
      s = document.createElement('script');
      s.src = JS_URL; s.async = true; s.setAttribute('data-leaflet', '1');
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => resolve(window.L));
    s.addEventListener('error', () => reject(new Error('leaflet failed to load')));
    if (window.L) resolve(window.L);
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default function MapView({ trip, days, activities, onEdit, onSetCoords, onAddLocated }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const stopLayer = useRef(null);
  const routeLayer = useRef(null);
  const nearbyLayer = useRef(null);
  const markers = useRef({});

  const [err, setErr] = useState('');
  const [day, setDay] = useState('all');
  const [focused, setFocused] = useState(null);
  const [locating, setLocating] = useState(null); // {done, total}
  const [kind, setKind] = useState(null);
  const [places, setPlaces] = useState([]);
  const [placesBusy, setPlacesBusy] = useState(false);
  const [dropped, setDropped] = useState(null); // {lat,lng,label,name}

  const inDay = useCallback(
    (a) => day === 'all' || a.day === day,
    [day],
  );

  /* Every activity with coordinates is a stop. There is no other kind. */
  const stops = useMemo(() => activities
    .filter((a) => a.lat != null && a.lng != null)
    .filter(inDay)
    .slice()
    .sort((a, b) => (a.day === b.day ? sortActs(a, b) : (a.day < b.day ? -1 : 1))),
  [activities, inDay]);

  /* Has a place written down, but we have not worked out where that is yet. */
  const unresolved = useMemo(
    () => activities.filter((a) => (a.location || '').trim() && a.lat == null),
    [activities],
  );

  /* Nothing to go on at all — needs a location before it can be shown. */
  const placeless = useMemo(
    () => activities.filter((a) => !(a.location || '').trim() && a.lat == null),
    [activities],
  );

  /** Consecutive legs within a day, for the route line and the distances. */
  const legs = useMemo(() => {
    const out = {};
    let prev = null;
    stops.forEach((a) => {
      if (prev && prev.day === a.day) {
        out[a.id] = haversine(prev.lat, prev.lng, a.lat, a.lng);
      }
      prev = a;
    });
    return out;
  }, [stops]);

  const totalKm = useMemo(
    () => Object.values(legs).reduce((s, k) => s + k, 0),
    [legs],
  );

  /* ------------------------------------------------- resolve locations --- */
  const resolving = useRef(false);

  const resolveAll = useCallback(async () => {
    if (resolving.current || !onSetCoords) return;
    const todo = activities.filter((a) => (a.location || '').trim() && a.lat == null);
    if (!todo.length) return;
    resolving.current = true;
    setLocating({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i += 1) {
      const a = todo[i];
      try {
        // Sequential on purpose: Nominatim allows one request per second.
        // eslint-disable-next-line no-await-in-loop
        const hit = await geocodeBest(a.location, trip.destination);
        if (hit) await onSetCoords(a.id, hit.lat, hit.lng); // eslint-disable-line no-await-in-loop
      } catch (e) { /* one failure should not stop the rest */ }
      setLocating({ done: i + 1, total: todo.length });
    }
    setLocating(null);
    resolving.current = false;
  }, [activities, trip, onSetCoords]);

  // Resolve whatever is outstanding when the map opens.
  const kicked = useRef(false);
  useEffect(() => {
    if (kicked.current || !unresolved.length) return;
    kicked.current = true;
    resolveAll();
  }, [unresolved.length, resolveAll]);

  /* ------------------------------------------------------------- nearby --- */
  /**
   * Search around a real stop, never around an average of them: the midpoint
   * of a Tokyo stop and a Kyoto stop is open countryside, where nothing is
   * nearby. Falls back to the first stop in view.
   */
  const anchor = useMemo(() => {
    const at = (focused && stops.find((s) => s.id === focused)) || stops[0];
    return at ? { lat: at.lat, lng: at.lng, title: at.title } : null;
  }, [stops, focused]);

  useEffect(() => {
    if (!kind || !anchor) { setPlaces([]); return undefined; }
    let alive = true;
    setPlacesBusy(true);
    nearby(anchor.lat, anchor.lng, kind)
      .then((list) => { if (alive) setPlaces(list); })
      .catch(() => { if (alive) { setPlaces([]); setErr('Nearby search is busy right now — try again in a moment.'); } })
      .finally(() => { if (alive) setPlacesBusy(false); });
    return () => { alive = false; };
  }, [kind, anchor]);

  /* ---------------------------------------------------------------- map --- */
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !elRef.current) return;
      if (!mapRef.current) {
        if (elRef.current._leaflet_id) delete elRef.current._leaflet_id;
        mapRef.current = L.map(elRef.current, { scrollWheelZoom: false })
          .setView([35.68, 139.76], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(mapRef.current);
        routeLayer.current = L.layerGroup().addTo(mapRef.current);
        stopLayer.current = L.layerGroup().addTo(mapRef.current);
        nearbyLayer.current = L.layerGroup().addTo(mapRef.current);

        // Clicking empty map is how you add a stop somewhere you spotted.
        mapRef.current.on('click', async (e) => {
          const { lat, lng } = e.latlng;
          setDropped({ lat, lng, label: 'Looking up…', name: '' });
          try {
            const r = await reverseGeocode(lat, lng);
            setDropped({ lat, lng, label: r.label, name: r.name });
          } catch (e2) {
            setDropped({ lat, lng, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, name: '' });
          }
        });
      }

      const map = mapRef.current;
      stopLayer.current.clearLayers();
      routeLayer.current.clearLayers();
      markers.current = {};

      const pts = [];
      const byDay = {};
      stops.forEach((a, i) => {
        const cat = categoryOf(a.category);
        const colour = catColor(cat.id);
        const isFocus = focused === a.id;
        const icon = L.divIcon({
          className: '',
          html: `<div class="mk${isFocus ? ' mk-focus' : ''}" style="--mk:${colour}">
                   <span>${i + 1}</span>
                 </div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        });
        const m = L.marker([a.lat, a.lng], { icon }).addTo(stopLayer.current);
        const when = `${fmtDayTiny(a.day)}${a.start_time ? ` · ${fmtTime(a.start_time)}` : ''}`;
        m.bindPopup(
          `<strong>${escapeHtml(a.title)}</strong><br>${escapeHtml(when)}`
          + (a.location ? `<br><span style="opacity:.7">${escapeHtml(a.location)}</span>` : ''),
        );
        m.on('click', () => { setFocused(a.id); m.openPopup(); });
        markers.current[a.id] = m;
        pts.push([a.lat, a.lng]);
        (byDay[a.day] = byDay[a.day] || []).push([a.lat, a.lng]);
      });

      // One dashed line per day, in time order — the shape of that day.
      Object.keys(byDay).forEach((d) => {
        if (byDay[d].length < 2) return;
        L.polyline(byDay[d], {
          color: catColor('sightseeing'),
          weight: 2.5,
          opacity: .55,
          dashArray: '5 6',
        }).addTo(routeLayer.current);
      });

      if (pts.length === 1) map.setView(pts[0], 14);
      else if (pts.length > 1) map.fitBounds(pts, { padding: [44, 44] });
      setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 60);
    }).catch(() => setErr('The map could not be loaded. Check your connection and reload.'));
    return () => { cancelled = true; };
  }, [stops, focused]);

  // Nearby results are a separate layer so they never disturb the stops.
  useEffect(() => {
    if (!mapRef.current || !nearbyLayer.current || !window.L) return;
    const L = window.L;
    nearbyLayer.current.clearLayers();
    places.forEach((p) => {
      const m = L.circleMarker([p.lat, p.lng], {
        radius: 6,
        color: catColor(NEARBY_KINDS.find((k) => k.id === p.kind)?.category || 'other'),
        weight: 2,
        fillOpacity: .55,
      }).addTo(nearbyLayer.current);
      m.bindPopup(`<strong>${escapeHtml(p.name)}</strong><br><span style="opacity:.7">${escapeHtml(p.detail)} · ${fmtKm(p.km)} away</span>`);
    });
  }, [places]);

  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
  }, []);

  function focus(a) {
    setFocused(a.id);
    const m = markers.current[a.id];
    if (m && mapRef.current) {
      mapRef.current.flyTo([a.lat, a.lng], Math.max(mapRef.current.getZoom(), 14), { duration: .5 });
      m.openPopup();
    }
  }

  const targetDay = day === 'all' ? (days[0] || null) : day;

  async function addDropped(title) {
    if (!dropped || !onAddLocated || !targetDay) return;
    await onAddLocated({
      day: targetDay,
      title: title || dropped.name || 'New stop',
      location: dropped.label,
      lat: dropped.lat,
      lng: dropped.lng,
      category: 'sightseeing',
    });
    setDropped(null);
  }

  async function addPlace(p) {
    if (!onAddLocated || !targetDay) return;
    const cat = NEARBY_KINDS.find((k) => k.id === p.kind);
    await onAddLocated({
      day: targetDay,
      title: p.name,
      location: p.detail ? `${p.name} · ${p.detail}` : p.name,
      lat: p.lat,
      lng: p.lng,
      category: cat ? cat.category : 'sightseeing',
    });
  }

  return (
    <div>
      <div className="page-head spread">
        <div>
          <h2>Map</h2>
          <div className="small muted">
            {stops.length} stop{stops.length === 1 ? '' : 's'}
            {totalKm > 0 ? ` · ${fmtKm(totalKm)} between them` : ''}
            {locating ? ` · locating ${locating.done}/${locating.total}…` : ''}
          </div>
        </div>
      </div>

      {days.length > 1 ? (
        <div className="daystrip">
          <button type="button" className={`daychip${day === 'all' ? ' active' : ''}`}
            onClick={() => { setDay('all'); setFocused(null); }}>
            <span className="daychip-n">All</span>
            <span className="daychip-d">{days.length} days</span>
          </button>
          {days.map((d, i) => (
            <button key={d} type="button" className={`daychip${day === d ? ' active' : ''}`}
              onClick={() => { setDay(d); setFocused(null); }}>
              <span className="daychip-n">Day {i + 1}</span>
              <span className="daychip-d">{fmtDayTiny(d)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}

      <div className="maplayout">
        <div className="map-wrap"><div className="map-el" ref={elRef} /></div>

        <aside className="mapside">
          {dropped ? (
            <div className="card notice mapside-drop">
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <strong className="small">{dropped.name || 'Dropped point'}</strong>
                  <div className="tiny muted" style={{ overflowWrap: 'anywhere' }}>{dropped.label}</div>
                </div>
                <button className="btn ghost sm icon-btn" aria-label="Dismiss"
                  onClick={() => setDropped(null)}><X size={14} /></button>
              </div>
              <button className="btn primary sm" style={{ width: '100%', marginTop: 10 }}
                disabled={!targetDay} onClick={() => addDropped(dropped.name)}>
                <Plus size={15} /> Add here{targetDay ? ` on ${fmtDayTiny(targetDay)}` : ''}
              </button>
            </div>
          ) : null}

          <div className="mapside-head">
            <Compass size={15} />
            <span>Explore nearby</span>
          </div>
          {anchor ? (
            <p className="tiny dim" style={{ marginTop: -4, marginBottom: 9 }}>
              around {anchor.title}
            </p>
          ) : null}
          <div className="chiprow" style={{ marginBottom: 10 }}>
            {NEARBY_KINDS.map((k) => (
              <button key={k.id} className="btn sm" aria-pressed={kind === k.id}
                onClick={() => setKind(kind === k.id ? null : k.id)}>{k.label}</button>
            ))}
          </div>

          {kind ? (
            <div className="mapside-scroll">
              {placesBusy ? (
                <div className="small muted mapside-busy">
                  <Loader2 size={14} className="spin" /> Searching near{' '}
                  {anchor ? anchor.title : 'your stops'}…
                </div>
              ) : places.length === 0 ? (
                <p className="small muted">
                  Nothing of that kind within about a kilometre of{' '}
                  {anchor ? anchor.title : 'this stop'}.
                </p>
              ) : places.map((p) => (
                <div className="nearby" key={p.id}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="nearby-name">{p.name}</div>
                    <div className="tiny dim">
                      {p.detail ? `${p.detail} · ` : ''}{fmtKm(p.km)} away
                    </div>
                  </div>
                  <button className="btn sm" disabled={!targetDay} onClick={() => addPlace(p)}
                    aria-label={`Add ${p.name}`}><Plus size={14} /></button>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: 0 }}>
              Pick a category to find places near{' '}
              <strong>{anchor ? anchor.title : 'your stops'}</strong>. Select a different stop
              below to search around that one instead, or click anywhere on the map to add a stop
              there.
            </p>
          )}
        </aside>
      </div>

      {stops.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>
            {day === 'all' ? 'Every stop, in order' : `Day ${days.indexOf(day) + 1}, in order`}
          </h3>
          <div className="stoplist">
            {stops.map((a, i) => {
              const cat = categoryOf(a.category);
              const Icon = categoryIcon(cat.id);
              const leg = legs[a.id];
              return (
                <div key={a.id}>
                  {leg != null ? (
                    <div className={`leg${leg > 60 ? ' leg-far' : ''}`}>
                      {leg > 60 ? <TriangleAlert size={12} />
                        : leg > 5 ? <TrainFront size={12} />
                          : <Footprints size={12} />}
                      {fmtKm(leg)}
                      {leg > 60 ? ' — a long way for one day, check how you are getting there'
                        : leg > 5 ? ' — too far to walk'
                          : ` · about ${walkMinutes(leg)} min walk`}
                    </div>
                  ) : null}
                  <div className={`stop${focused === a.id ? ' is-focus' : ''}`}
                    role="button" tabIndex={0}
                    onClick={() => focus(a)}
                    onKeyDown={(e) => { if (e.key === 'Enter') focus(a); }}>
                    <span className="stop-n">{i + 1}</span>
                    <span className={`catico cat-${cat.id}`} aria-hidden="true"><Icon size={13} /></span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="stop-name">{a.title}</div>
                      <div className="tiny dim">
                        {fmtDayTiny(a.day)}{a.start_time ? ` · ${fmtTime(a.start_time)}` : ''}
                        {a.location ? ` · ${a.location}` : ''}
                      </div>
                    </div>
                    <button className="btn ghost sm icon-btn" aria-label={`Edit ${a.title}`}
                      onClick={(e) => { e.stopPropagation(); onEdit(a); }}>
                      <Navigation size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="empty" style={{ marginTop: 14 }}>
          <MapPinOff size={26} className="empty-ico" aria-hidden="true" />
          <p className="empty-title">Nothing on the map yet</p>
          <p className="small muted" style={{ marginTop: 0, marginBottom: 0 }}>
            Give an activity a location and it appears here automatically — or click anywhere on
            the map to add a stop.
          </p>
        </div>
      )}

      {placeless.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 15, marginBottom: 6 }}>Without a location</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            These have no place written down yet, so there is nothing to put on the map.
          </p>
          <div className="chiprow">
            {placeless.map((a) => (
              <button key={a.id} className="btn sm" onClick={() => onEdit(a)}>{a.title}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
