'use client';
import { useCallback, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { CATEGORIES, fmtDay } from '@/lib/util';
import { useModalChrome } from '@/lib/useModal';

export default function ActivityModal({ draft, days, currency, onChange, onSave, onDelete, onClose }) {
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [geoErr, setGeoErr] = useState('');
  const [confirm, setConfirm] = useState(''); // '' | 'delete' | 'discard'
  const pristine = useRef(JSON.stringify(draft));

  const set = (patch) => onChange({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== pristine.current;

  const attemptClose = useCallback(() => {
    if (dirty) setConfirm('discard'); else onClose();
  }, [dirty, onClose]);

  useModalChrome({ onEscape: attemptClose, onSubmit: () => onSave(draft) });

  // Searches whatever is already typed — no retyping the name into a second box.
  async function search() {
    const term = (draft.location || draft.title || '').trim();
    if (!term) { setGeoErr('Type a place name or address above first.'); return; }
    setSearching(true); setGeoErr(''); setHits([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(term)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const json = await res.json();
      if (!Array.isArray(json) || json.length === 0) setGeoErr(`Nothing matched "${term}".`);
      setHits(Array.isArray(json) ? json : []);
    } catch (err) {
      setGeoErr('Place search is unavailable right now — you can still save without a pin.');
    }
    setSearching(false);
  }

  const pinned = draft.lat != null && draft.lng != null && draft.lat !== '';

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) attemptClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Activity">
        <div className="modal-head">
          <h3>{draft.id ? 'Edit activity' : 'New activity'}</h3>
          <button className="btn ghost sm" onClick={attemptClose} aria-label="Close"><X size={15} /></button>
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
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
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
            <div className="withbtn">
              <input id="al" className="input" value={draft.location || ''}
                placeholder="Senso-ji, Asakusa"
                onChange={(e) => set({ location: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
              <button className="btn" type="button" disabled={searching} onClick={search}>
                {searching ? '…' : <><Search size={15} /> Find</>}
              </button>
            </div>
            <div className="tiny dim" style={{ marginTop: 6 }}>
              Searches what you typed above, or the activity name if this is blank.
            </div>
            {geoErr ? <div className="err">{geoErr}</div> : null}
            {hits.length ? (
              <div className="geo-list">
                {hits.map((h) => (
                  <button type="button" key={`${h.place_id}`}
                    onClick={() => {
                      set({ location: h.display_name, lat: Number(h.lat), lng: Number(h.lon) });
                      setHits([]); setGeoErr('');
                    }}>{h.display_name}</button>
                ))}
              </div>
            ) : null}
            {pinned ? (
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
          {confirm === 'discard' ? (
            <>
              <span className="small muted" style={{ marginRight: 'auto' }}>Discard your changes?</span>
              <button className="btn" onClick={() => setConfirm('')}>Keep editing</button>
              <button className="btn danger-solid" onClick={onClose}>Discard</button>
            </>
          ) : confirm === 'delete' ? (
            <>
              <span className="small muted" style={{ marginRight: 'auto' }}>Delete this activity?</span>
              <button className="btn" onClick={() => setConfirm('')}>Cancel</button>
              <button className="btn danger-solid" onClick={() => onDelete(draft)}>Delete</button>
            </>
          ) : (
            <>
              {draft.id ? (
                <button className="btn danger" style={{ marginRight: 'auto' }}
                  onClick={() => setConfirm('delete')}>Delete</button>
              ) : null}
              <span className="kbd-hint">⌘↵ to save · Esc to close</span>
              <button className="btn" onClick={attemptClose}>Cancel</button>
              <button className="btn primary" onClick={() => onSave(draft)}>
                {draft.id ? 'Save' : 'Add activity'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
