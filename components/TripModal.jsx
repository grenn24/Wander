'use client';
import { CURRENCIES } from '@/lib/util';

export default function TripModal({ draft, onChange, onSave, onClose }) {
  const set = (patch) => onChange({ ...draft, ...patch });
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Trip settings">
        <div className="modal-head">
          <h3>{draft.id ? 'Trip settings' : 'New trip'}</h3>
          <button className="btn ghost sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="label" htmlFor="tn">Trip name</label>
            <input id="tn" className="input" value={draft.name || ''} autoFocus
              placeholder="Japan, December" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="td">Destination</label>
            <input id="td" className="input" value={draft.destination || ''}
              placeholder="Tokyo & Nagoya" onChange={(e) => set({ destination: e.target.value })} />
          </div>
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="ts">Start</label>
              <input id="ts" className="input" type="date" value={draft.start_date || ''}
                onChange={(e) => set({ start_date: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="te">End</label>
              <input id="te" className="input" type="date" value={draft.end_date || ''}
                onChange={(e) => set({ end_date: e.target.value })} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="tc">Currency</label>
              <select id="tc" className="select" value={draft.currency || 'SGD'}
                onChange={(e) => set({ currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="tb">Budget (optional)</label>
              <input id="tb" className="input mono" inputMode="decimal" value={draft.budget ?? ''}
                placeholder="3000" onChange={(e) => set({ budget: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(draft)}>
            {draft.id ? 'Save' : 'Create trip'}
          </button>
        </div>
      </div>
    </div>
  );
}
