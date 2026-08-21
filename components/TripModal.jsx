'use client';
import { useCallback, useRef, useState } from 'react';
import { CURRENCIES, dayRange } from '@/lib/util';
import { useModalChrome } from '@/lib/useModal';

export default function TripModal({ draft, onChange, onSave, onClose }) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pristine = useRef(JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== pristine.current;

  const set = (patch) => onChange({ ...draft, ...patch });

  const start = draft.start_date || '';
  const end = draft.end_date || '';
  const badRange = !!(start && end && end < start);
  const length = badRange ? 0 : dayRange(start, end).length;

  // Pushing the start past the end used to silently collapse the trip to one
  // day, so carry the end along instead.
  function setStart(v) {
    const patch = { start_date: v };
    if (v && draft.end_date && draft.end_date < v) patch.end_date = v;
    onChange({ ...draft, ...patch });
  }

  const save = useCallback(() => { if (!badRange) onSave(draft); }, [badRange, onSave, draft]);
  const attemptClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true); else onClose();
  }, [dirty, onClose]);

  useModalChrome({ onEscape: attemptClose, onSubmit: save });

  const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } };

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) attemptClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Trip settings">
        <div className="modal-head">
          <h3>{draft.id ? 'Trip settings' : 'New trip'}</h3>
          <button className="btn ghost sm" onClick={attemptClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="label" htmlFor="tn">Trip name</label>
            <input id="tn" className="input" value={draft.name || ''} autoFocus
              placeholder="Japan, December" onKeyDown={onEnter}
              onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="td">Destination</label>
            <input id="td" className="input" value={draft.destination || ''}
              placeholder="Tokyo & Nagoya" onKeyDown={onEnter}
              onChange={(e) => set({ destination: e.target.value })} />
          </div>
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="ts">Start</label>
              <input id="ts" className="input" type="date" value={start}
                onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="te">End</label>
              <input id="te" className="input" type="date" value={end} min={start || undefined}
                onChange={(e) => set({ end_date: e.target.value })} />
            </div>
          </div>
          {badRange ? (
            <div className="err" style={{ marginTop: -6, marginBottom: 12 }}>
              The end date is before the start date.
            </div>
          ) : (
            <div className="tiny dim" style={{ marginTop: -6, marginBottom: 12 }}>
              {length ? `${length} day${length === 1 ? '' : 's'}` : 'Pick dates to build the day-by-day plan.'}
            </div>
          )}
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
                placeholder="3000" onKeyDown={onEnter}
                onChange={(e) => set({ budget: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          {confirmDiscard ? (
            <>
              <span className="small muted" style={{ marginRight: 'auto' }}>Discard your changes?</span>
              <button className="btn" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
              <button className="btn danger-solid" onClick={onClose}>Discard</button>
            </>
          ) : (
            <>
              <span className="kbd-hint">⌘↵ to save · Esc to close</span>
              <button className="btn" onClick={attemptClose}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={badRange}>
                {draft.id ? 'Save' : 'Create trip'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
