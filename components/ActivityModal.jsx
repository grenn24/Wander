'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, MapPin } from 'lucide-react';
import { CATEGORIES, fmtDay } from '@/lib/util';
import { TRANSPORT, transportOf } from '@/lib/transport';
import { searchPlaces } from '@/lib/geo';
import Select from '@/components/Select';
import ActivityMap from '@/components/ActivityMap';
import TimeField from '@/components/TimeField';
import { googleMapsAvailable } from '@/components/GoogleMap';
import { useModalChrome } from '@/lib/useModal';

/**
 * Whether there is room to put the map beside the form.
 *
 * Asked in JavaScript rather than answered in CSS because only one map may
 * exist: a Google map built inside a display:none column measures zero and
 * comes back blank when the column is shown. Crossing the breakpoint rebuilds
 * it, which is the correct amount of work for something that happens when you
 * drag a window edge.
 */
function useRoomForMap() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 900px)');
    const read = () => setWide(m.matches);
    read();
    m.addEventListener('change', read);
    return () => m.removeEventListener('change', read);
  }, []);
  return wide;
}

export default function ActivityModal({ draft, days, currency, onChange, onSave, onDelete, onClose }) {
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [geoErr, setGeoErr] = useState('');
  const [active, setActive] = useState(-1);
  const [confirm, setConfirm] = useState(''); // '' | 'delete' | 'discard'
  // What the map panel has made of the words so far, so the field can say it.
  const [guess, setGuess] = useState({ busy: false, place: null });
  const pristine = useRef(JSON.stringify(draft));
  // Suggestions answer typing. Without this, opening an activity that has a
  // written location dropped a list of alternatives over the form before
  // anyone had touched anything.
  const typed = useRef(false);
  const boxRef = useRef(null);
  const wide = useRoomForMap();

  const set = (patch) => onChange({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== pristine.current;

  const attemptClose = useCallback(() => {
    if (dirty) setConfirm('discard'); else onClose();
  }, [dirty, onClose]);

  /*
   * Nothing to save is not a thing to offer.
   *
   * Saving an activity you only opened to look at writes an updated_at, shows
   * a toast and tells everyone else on the trip that something changed, all
   * for no change at all. A new one needs a name before it is anything.
   */
  const canSave = draft.id ? dirty : !!(draft.title || '').trim();

  useModalChrome({
    onEscape: attemptClose,
    onSubmit: () => { if (canSave) onSave(draft); },
  });

  /*
   * The dialog takes focus, not the first field in it.
   *
   * Putting the caret in "What" raises the keyboard the moment the editor
   * opens, which on a phone covers half of what you came to look at — and most
   * openings are to check a time or a place, not to rename anything. Focus
   * still has to leave the page behind, or Escape and the tab order would stay
   * out there, so it lands on the dialog itself: announced by screen readers,
   * and no keyboard until someone asks for one by tapping a field.
   */
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.focus({ preventScroll: true });
  }, []);

  const pinned = draft.lat != null && draft.lng != null && draft.lat !== '';
  const mode = draft.category === 'transport'
    ? transportOf(draft.subtype || 'flight') : null;

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
    if (!typed.current || pinned || term.length < 3) {
      setHits([]); setGeoErr(''); return undefined;
    }
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


  /*
   * The map goes beside the form when there is width for it and under the
   * location field when there is not.
   *
   * Beside, it is always there — an empty panel that fills in as you pick a
   * place is steadier than a modal that grows a column halfway through, and it
   * says what the field is for before anyone uses it. Underneath, it appears
   * only once there is something to draw: a phone has no room to spend on a
   * box explaining itself.
   */
  const hasMaps = googleMapsAvailable();
  const beside = hasMaps && wide;
  const under = hasMaps && !wide
    && (pinned || (draft.location || '').trim().length >= 3);

  const pick = (patch) => set(patch);

  /* Below three characters there is nothing to look up, so there is nothing
     for the guess to be about — and last search's answer must not hang around
     describing this one. */
  const said = (draft.location || '').trim().length >= 3;
  const found = said && !pinned && !guess.busy ? guess.place : null;

  /* One panel, two homes. Only ever rendered once — two of these would be two
     Google maps competing for the same activity. */
  const where = (compact) => (
    <ActivityMap draft={draft} onPick={pick} onGuess={setGuess} compact={compact} />
  );

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) attemptClose(); }}>
      <div className={`modal${beside ? ' modal-wide' : ''}`} ref={boxRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-label="Activity">
        <div className="modal-head">
          <h3>{draft.id ? 'Edit activity' : 'New activity'}</h3>
          <button className="btn ghost sm" onClick={attemptClose}
            data-tip="Close  Esc" aria-label="Close"><X size={15} /></button>
        </div>

        <div className="modal-split">
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
                  onChange={(v) => set({
                    category: v,
                    // A bus has no gate. Changing what this is drops what the
                    // last answer carried, rather than keeping fields that
                    // nothing on the form will show.
                    ...(v === 'transport'
                      ? (draft.subtype ? {} : { subtype: 'flight' })
                      : { subtype: null, details: {} }),
                  })}
                  options={CATEGORIES.map((c) => ({
                    value: c.id,
                    label: c.label,
                    icon: <span className={`catdot cat-${c.id}`} aria-hidden="true" />,
                  }))}
                />
              </div>
            </div>

            {/*
              * Transport is a parent type, so it asks a second question — and
              * then asks only what that answer actually has. A flight has a
              * gate and a terminal; a ferry has a pier. One form carrying
              * every field would be nine boxes of which two applied.
              */}
            {draft.category === 'transport' ? (
              <div className="field">
                <label className="label" htmlFor="ak">How</label>
                <Select
                  id="ak" label="How"
                  value={draft.subtype || 'flight'}
                  onChange={(v) => set({ subtype: v })}
                  options={TRANSPORT.map((t) => ({
                    value: t.id,
                    label: t.label,
                    icon: <t.icon size={14} aria-hidden="true" />,
                  }))}
                />
              </div>
            ) : null}

            {mode ? (
              <div className="row tfields">
                {mode.fields.map((f) => (
                  <div className="field" key={f.k}>
                    <label className="label" htmlFor={`tf-${f.k}`}>{f.label}</label>
                    <input id={`tf-${f.k}`} className="input" placeholder={f.ph}
                      value={(draft.details && draft.details[f.k]) || ''}
                      onChange={(e) => set({
                        details: { ...(draft.details || {}), [f.k]: e.target.value },
                      })} />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="row">
              <div className="field">
                <label className="label" htmlFor="as">Start</label>
                <TimeField id="as" label="Start" value={draft.start_time || ''}
                  onChange={(v) => set({ start_time: v })} />
              </div>
              <div className="field">
                <label className="label" htmlFor="ae">End</label>
                <TimeField id="ae" label="End" value={draft.end_time || ''}
                  onChange={(v) => set({ end_time: v })} />
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
                  onChange={(e) => { typed.current = true; set({
                    location: e.target.value,
                    // The words and the pin have to agree, so changing one drops
                    // the other.
                    lat: null, lng: null, place_id: null, photo_ref: null,
                  }); }}
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

              {/*
                * No "placed" versus "not placed" here.
                *
                * The map resolves a written location on its own, so the warning
                * this used to show — that typed text stays off the map — was not
                * even true. Picking a match is a shortcut that saves the lookup
                * and pins the exact spot; typing the name is the same thing more
                * slowly. Neither is an error state worth interrupting anyone for.
                */}
              {/*
                * What the map is currently going on, said where the doubt is.
                * "Anything written here is found on the map for you" described
                * the mechanism and left the outcome to be guessed at — and
                * with a marker drawn for the guess as well, a place nobody had
                * agreed to read as a place already chosen.
                */}
              <p className="pinstate is-idle">
                <MapPin size={13} aria-hidden="true" />
                <span>
                  {pinned ? 'Pinned to this spot.'
                    : !said ? 'Anything written here is found on the map for you.'
                      : guess.busy ? 'Looking that up…'
                        : found ? `Best match — ${found.name || found.label}`
                          : 'Nothing found for that yet.'}
                </span>
                {pinned ? (
                  <button className="btn ghost sm" type="button"
                    onClick={() => set({ lat: null, lng: null, place_id: null, photo_ref: null })}>
                    clear
                  </button>
                ) : found ? (
                  /* The whole point of naming the match is to be able to take
                     it, so the button that does is on the same line. */
                  <button className="btn sm pinstate-go" type="button"
                    onClick={() => choose(found)}>
                    <MapPin size={13} aria-hidden="true" /> Select
                  </button>
                ) : null}
              </p>

              {under ? where(true) : null}
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

          {beside ? (
            <aside className="modal-aside" aria-label="Where this is">
              <span className="label">Where this is</span>
              {where(false)}
            </aside>
          ) : null}
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
              <button className="btn" onClick={attemptClose}>
                {dirty ? 'Cancel' : 'Close'}
              </button>
              <button className="btn primary" disabled={!canSave}
                data-tip={canSave ? undefined
                  : draft.id ? 'Nothing has changed yet' : 'Give it a name first'}
                onClick={() => onSave(draft)}>
                {draft.id ? 'Save' : 'Add activity'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
