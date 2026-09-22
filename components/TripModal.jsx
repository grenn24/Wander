'use client';
import { useCallback, useId, useRef, useState } from 'react';
import { X, SlidersHorizontal, Users, Download, CalendarDays } from 'lucide-react';
import { CURRENCIES, dayRange } from '@/lib/util';
import TimezoneField from '@/components/TimezoneField';
import Select from '@/components/Select';
import DateField from '@/components/DateField';
import { useModalChrome } from '@/lib/useModal';

const TAB_ICONS = { details: SlidersHorizontal, people: Users, offline: Download, calendar: CalendarDays };

export default function TripModal({ draft, onChange, onSave, onClose, sections = [], initialSection = 'details', leaving = false }) {
  const [active, setActive] = useState(initialSection);
  const id = useId();
  const dialog = useRef(null);
  const tabs = [{ id: 'details', label: 'Details' }, ...sections];
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

  // A nested delete/remove confirmation owns its keyboard shortcuts.
  useModalChrome({
    onEscape: () => { if (!dialog.current?.querySelector('[role="alertdialog"]')) attemptClose(); },
    onSubmit: () => { if (!dialog.current?.querySelector('[role="alertdialog"]') && (active === 'details' || dirty)) save(); },
  });

  const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } };

  return (
    <div className="backdrop" data-state={leaving ? 'exit' : undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget) attemptClose(); }}>
      <div ref={dialog} className={`modal${sections.length ? ' trip-edit-modal' : ''}`} role="dialog" aria-modal="true" aria-label={draft.id ? 'Edit trip' : 'New trip'}>
        <div className="modal-head">
          <h3>{draft.id ? 'Edit trip' : 'New trip'}</h3>
          <button className="btn ghost sm" onClick={attemptClose} aria-label="Close"><X size={15} /></button>
        </div>
        {sections.length ? <div className="trip-edit-tabs" role="tablist" aria-label="Trip options">
          {tabs.map((tab, index) => {
            const Icon = TAB_ICONS[tab.id];
            return <button key={tab.id} type="button" role="tab"
            id={`${id}-${tab.id}-tab`} aria-controls={`${id}-${tab.id}-panel`}
            aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1}
            onClick={() => { setActive(tab.id); setConfirmDiscard(false); }}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              setActive(tabs[next].id);
              event.currentTarget.parentElement.children[next].focus();
            }}>{Icon ? <Icon size={16} aria-hidden="true" /> : null}<span>{tab.label}</span></button>;
          })}
        </div> : null}
        <div className="modal-body" hidden={active !== 'details'} role={sections.length ? 'tabpanel' : undefined}
          id={`${id}-details-panel`} aria-labelledby={sections.length ? `${id}-details-tab` : undefined}>
          <div className="field">
            <label className="label" htmlFor="tn">Trip name</label>
            <input id="tn" className="input" value={draft.name || ''} autoFocus={active === 'details'}
              placeholder="Japan, December" onKeyDown={onEnter}
              onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="td">Destination</label>
            <input id="td" className="input" value={draft.destination || ''}
              placeholder="Tokyo & Nagoya" onKeyDown={onEnter}
              onChange={(e) => set({ destination: e.target.value })} />
          </div>
          <TimezoneField id="trip-timezone" value={draft.timezone} onChange={(timezone) => set({ timezone })} />
          <p className="tiny dim">Use the destination’s local time. Flights have their own departure and arrival zones.</p>
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="ts">Start</label>
              <DateField id="ts" label="Trip start" value={start} onChange={setStart} />
            </div>
            <div className="field">
              <label className="label" htmlFor="te">End</label>
              <DateField id="te" label="Trip end" value={end} min={start || undefined}
                onChange={(value) => set({ end_date: value })} />
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
              <Select
                id="tc" label="Currency"
                value={draft.currency || 'SGD'}
                onChange={(v) => set({ currency: v })}
                options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="tb">Budget (optional)</label>
              <input id="tb" className="input mono" inputMode="decimal" value={draft.budget ?? ''}
                placeholder="3000" onKeyDown={onEnter}
                onChange={(e) => set({ budget: e.target.value })} />
            </div>
          </div>
        </div>
        {sections.map((section) => active === section.id ? <div key={section.id}
          className="modal-body" role="tabpanel" id={`${id}-${section.id}-panel`} aria-labelledby={`${id}-${section.id}-tab`}>
          {dirty ? <p className="small muted">You have unsaved changes in Details. Downloads and calendar actions use the saved trip.</p> : null}
          {section.content}
        </div> : null)}
        <div className="modal-foot">
          {confirmDiscard ? (
            <>
              <span className="small muted" style={{ marginRight: 'auto' }}>Discard your changes?</span>
              <button className="btn" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
              <button className="btn danger-solid" onClick={onClose}>Discard</button>
            </>
          ) : (
            <>
              {active === 'details' || dirty ? <>
              <span className="kbd-hint">⌘↵ to save · Esc to close</span>
              <button className="btn" onClick={attemptClose}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={badRange}>
                {draft.id ? 'Save' : 'Create trip'}
              </button>
              </> : <button className="btn primary" onClick={attemptClose}>Done</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
