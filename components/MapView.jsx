'use client';
import { useEffect, useRef, useState } from 'react';
import { fmtDay, fmtTime, sortActs } from '@/lib/util';

const CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

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

export default function MapView({ trip, days, activities, onEdit }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [err, setErr] = useState('');
  const [dayFilter, setDayFilter] = useState('all');

  const pinned = activities
    .filter((a) => a.lat != null && a.lng != null)
    .filter((a) => dayFilter === 'all' || a.day === dayFilter)
    .slice().sort((a, b) => (a.day === b.day ? sortActs(a, b) : a.day < b.day ? -1 : 1));

  const unpinned = activities.filter((a) => a.lat == null || a.lng == null);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !elRef.current) return;
      if (!mapRef.current) {
        if (elRef.current._leaflet_id) { delete elRef.current._leaflet_id; }
        mapRef.current = L.map(elRef.current, { scrollWheelZoom: false }).setView([35.68, 139.76], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      const L2 = L;
      layerRef.current.clearLayers();
      const pts = [];
      pinned.forEach((a, i) => {
        const icon = L2.divIcon({
          className: '',
          html: `<div class="pin"><span>${i + 1}</span></div>`,
          iconSize: [26, 26], iconAnchor: [13, 26],
        });
        const marker = L2.marker([a.lat, a.lng], { icon }).addTo(layerRef.current);
        const when = `${fmtDay(a.day)}${a.start_time ? ` · ${fmtTime(a.start_time)}` : ''}`;
        marker.bindPopup(
          `<strong>${escapeHtml(a.title)}</strong><br>${escapeHtml(when)}` +
          (a.location ? `<br><span style="opacity:.7">${escapeHtml(a.location)}</span>` : '')
        );
        marker.on('click', () => marker.openPopup());
        pts.push([a.lat, a.lng]);
      });
      if (pts.length === 1) mapRef.current.setView(pts[0], 13);
      else if (pts.length > 1) mapRef.current.fitBounds(pts, { padding: [40, 40] });
      setTimeout(() => { if (mapRef.current) mapRef.current.invalidateSize(); }, 60);
    }).catch(() => setErr('Map tiles could not be loaded. Check your connection and retry.'));
    return () => { cancelled = true; };
  }, [pinned.length, dayFilter, activities]);

  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; }
  }, []);

  return (
    <div>
      <div className="page-head spread">
        <div>
          <h2>Map</h2>
          <div className="small muted">{pinned.length} pinned · {unpinned.length} without a location</div>
        </div>
        <select className="select" style={{ maxWidth: 200 }} value={dayFilter}
          aria-label="Filter by day" onChange={(e) => setDayFilter(e.target.value)}>
          <option value="all">All days</option>
          {days.map((d, i) => <option key={d} value={d}>Day {i + 1} — {fmtDay(d)}</option>)}
        </select>
      </div>

      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div className="map-wrap"><div className="map-el" ref={elRef} /></div>

      {pinned.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Pinned stops</h3>
          <table className="data">
            <thead><tr><th>#</th><th>Stop</th><th>Day</th><th>Place</th></tr></thead>
            <tbody>
              {pinned.map((a, i) => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => onEdit(a)}>
                  <td className="mono">{i + 1}</td>
                  <td>{a.title}</td>
                  <td className="muted">{fmtDay(a.day)}</td>
                  <td className="muted small">{a.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {unpinned.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 15, marginBottom: 6 }}>Not on the map yet</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Open one and use <strong>Find</strong> in the Location field to pin it.
          </p>
          <div className="chiprow">
            {unpinned.map((a) => (
              <button key={a.id} className="btn sm" onClick={() => onEdit(a)}>{a.title}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
