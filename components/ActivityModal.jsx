'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, MapPin, TriangleAlert } from 'lucide-react';
import { CATEGORIES, fmtDay } from '@/lib/util';
import { searchPlaces } from '@/lib/geo';
import Select from '@/components/Select';
import { useModalChrome } from '@/lib/useModal';

export default function ActivityModal({ draft, days, currency, onChange, onSave, onDelete, onClose }) {
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [geoErr, setGeoErr] = useState('');
  const [active, setActive] = useState(-1);
  const [confirm, setConfirm] = useState(''); // '' | 'delete' | 'discard'
  const pristine = useRef(JSON.stringify(draft));

  const set = (patch) => onChange({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== pristine.current;

  const attemptClose = useCallback(() => {
    if (dirty) setConfirm('discard'); else onClose();
  }, [dirty, onClose]);

  useModalChrome({ onEscape: attemptClose, onSubmit: () => onSave(draft) });

  const pinned = draft.lat != null && draft.lng != null && draft.lat !== '';

  /*
   * Typing looks for matches; only picking one pins the activity.
   *
   * Those were the same act before, behind a Find button, and the text left in
   * the box afterwards looked identical whether or not anything had been
   * pinned — so an activity could read as located and never appear on the map.
   * Editing the text now clears the pin, because a pin that no longer matches
   * the words next to it is worse than none.
   */
  useEffect(() => {
    const term = (draft.location || '').trim();
    if (pinned || term.length < 3) { setHits([]); setGeoErr(''); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      setSearching(true); setGeoErr('');
      try {
        const places = await searchPlaces(term);
        if (!alive) return;
        setHits(places);
        setActive(-1);
        if (!places.length) setGeoErr(`Nothing matched “${term}”.`);
      } catch (err) {
        if (alive) setGeoErr('Place search is unavailable — you can still save without a pin.');
      } finally {
        if (alive) setSearching(false);
      }
    }, 320);
    return () => { alive = false; clearTimeout(timer); };
  }, [draft.location, pinned]);

  function choose(h) {
    set({
      location: h.label,
      lat: h.lat,
      lng: h.lng,
      place_id: h.place_id || null,
      photo_ref: h.photo_ref || null,
    });
    setHits([]); setGeoErr(''); setActive(-1);
  }

  function onLocationKey(e) {
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(hits[active]); }
    else if (e.key === 'Escape') { setHits([]); setActive(-1); }
  }


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
              <Select
                id="ad" label="Day"
                value={draft.day || (days[0] || '')}
                onChange={(v) => set({ day: v })}
                options={(days.includes(draft.day) || !draft.day
                  ? days
                  : [draft.day, ...days]
                ).map((d) => ({
                  value: d,
                  label: days.includes(d) ? `Day ${days.indexOf(d) + 1}` : 'Outside the trip',
                  hint: fmtDay(d),
                }))}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="ac">Type</label>
              <Select
                id="ac" label="Type"
                value={draft.category || 'sightseeing'}
                onChange={(v) => set({ category: v })}
                options={CATEGORIES.map((c) => ({
                  value: c.id,
                  label: c.label,
                  icon: <span className={`catdot cat-${c.id}`} aria-hidden="true" />,
                }))}
              />
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
            <div className="ac">
              <input
                id="al" className="input" value={draft.location || ''}
                placeholder="Start typing a place…"
                role="combobox" aria-expanded={hits.length > 0} aria-controls="al-list"
                aria-autocomplete="list" autoComplete="off"
                aria-activedescendant={active >= 0 ? `al-opt-${active}` : undefined}
                onChange={(e) => set({
                  location: e.target.value,
                  // The words and the pin have to agree, so changing one drops
                  // the other.
                  lat: null, lng: null, place_id: null, photo_ref: null,
                })}
                onKeyDown={onLocationKey}
              />
              {searching ? <Loader2 size={15} className="spin ac-busy" aria-label="Searching" /> : null}
              {hits.length ? (
                <ul className="geo-list" id="al-list" role="listbox" aria-label="Matching places">
                  {hits.map((h, i) => (
                    <li key={h.place_id || h.label} id={`al-opt-${i}`} role="option"
                      aria-selected={i === active}
                      className={i === active ? 'is-active' : ''}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => { e.preventDefault(); choose(h); }}>
                      <MapPin size={13} aria-hidden="true" />
                      <span>{h.label}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {geoErr ? <div className="err">{geoErr}</div> : null}

            {/* Whether this activity is actually placed, said plainly — the
                text box looks the same either way. */}
            {pinned ? (
              <p className="pinstate is-pinned">
                <MapPin size={13} aria-hidden="true" />
                <span>On the map</span>
                <button className="btn ghost sm" type="button"
                  onClick={() => set({ lat: null, lng: null, place_id: null, photo_ref: null })}>
                  remove pin
                </button>
              </p>
            ) : (draft.location || '').trim() ? (
              <p className="pinstate is-loose">
                <TriangleAlert size={13} aria-hidden="true" />
                <span>Not placed yet — choose one of the matches, or this stays off the map.</span>
              </p>
            ) : (
              <p className="pinstate is-idle">
                <span>Type a place and pick a match to put this on the map.</span>
              </p>
            )}
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
