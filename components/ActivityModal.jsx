'use client';
import { useState } from 'react';
import { CATEGORIES, fmtDay } from '@/lib/util';

export default function ActivityModal({ draft, days, currency, onChange, onSave, onDelete, onClose }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [geoErr, setGeoErr] = useState('');
  const set = (patch) => onChange({ ...draft, ...patch });

  async function search(e) {
    e.preventDefault();
    const term = (q || draft.location || draft.title || '').trim();
    if (!term) return;
    setSearching(true); setGeoErr(''); setHits([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(term)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const json = await res.json();
      if (!Array.isArray(json) || json.length === 0) setGeoErr('No places matched that search.');
      setHits(Array.isArray(json) ? json : []);
    } catch (err) {
      setGeoErr('Place search is unavailable right now — you can paste coordinates instead.');
    }
    setSearching(false);
  }

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Activity">
        <div className="modal-head">
          <h3>{draft.id ? 'Edit activity' : 'New activity'}</h3>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="label" htmlFor="at">What</label>
            <input id="at" className="input" autoFocus value={draft.title || ''}
              placeholder="Senso-ji temple" onChange={(e) => set({ title: e.target.value })} />
          </div>

          <div className="row">
            <div className="field">
              <label className="label" htmlFor="ad">Day</label>
              <select id="ad" className="select" value={draft.day || (days[0] || '')}
                onChange={(e) => set({ day: e.target.value })}>
                {days.map((d, i) => <option key={d} value={d}>Day {i + 1} — {fmtDay(d)}</option>)}
                {draft.day && !days.includes(draft.day) ? <option value={draft.day}>{draft.day}</option> : null}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="ac">Type</label>
              <select id="ac" className="select" value={draft.category || 'sightseeing'}
                onChange={(e) => set({ category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label className="label" htmlFor="as">Start</label>
              <input id="as" className="input" type="time" value={draft.start_time || ''}
                onChange={(e) => set({ start_time: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="ae">End</label>
              <input id="ae" className="input" type="time" value={draft.end_time || ''}
                onChange={(e) => set({ end_time: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="ax">Cost ({currency})</label>
              <input id="ax" className="input mono" inputMode="decimal" value={draft.cost ?? ''}
                placeholder="0" onChange={(e) => set({ cost: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="al">Location</label>
            <input id="al" className="input" value={draft.location || ''}
              placeholder="2-3-1 Asakusa, Taito City" onChange={(e) => set({ location: e.target.value })} />
            <form onSubmit={search} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input className="input" value={q} placeholder="Search a place to pin it on the map"
                onChange={(e) => setQ(e.target.value)} />
              <button className="btn" disabled={searching}>{searching ? '…' : 'Find'}</button>
            </form>
            {geoErr ? <div className="err">{geoErr}</div> : null}
            {hits.length ? (
              <div className="geo-list">
                {hits.map((h) => (
                  <button type="button" key={`${h.place_id}`}
                    onClick={() => {
                      set({ location: h.display_name, lat: Number(h.lat), lng: Number(h.lon) });
                      setHits([]); setQ('');
                    }}>{h.display_name}</button>
                ))}
              </div>
            ) : null}
            {draft.lat != null && draft.lng != null && draft.lat !== '' ? (
              <div className="tiny dim" style={{ marginTop: 6 }}>
                Pinned at {Number(draft.lat).toFixed(4)}, {Number(draft.lng).toFixed(4)}{' '}
                <button className="btn ghost sm" type="button"
                  onClick={() => set({ lat: null, lng: null })}>remove pin</button>
              </div>
            ) : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="ab">Booking reference</label>
            <input id="ab" className="input" value={draft.booking_ref || ''}
              placeholder="JL712 / hotel conf. 4471X" onChange={(e) => set({ booking_ref: e.target.value })} />
          </div>

          <div className="field">
            <label className="label" htmlFor="an">Notes</label>
            <textarea id="an" className="textarea" value={draft.notes || ''}
              placeholder="Opening hours, who booked it, what to bring…"
              onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </div>

        <div className="modal-foot">
          {draft.id ? (
            <button className="btn danger" style={{ marginRight: 'auto' }}
              onClick={() => onDelete(draft.id)}>Delete</button>
          ) : null}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(draft)}>Save</button>
        </div>
      </div>
    </div>
  );
}
