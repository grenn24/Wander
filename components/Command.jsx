'use client';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sparkles, Loader2, X, Check, Trash2, CalendarDays, Pencil, Plus, Settings, Clock,
  Search, ArrowLeft, RotateCcw, CornerDownLeft, Backpack, Printer, ImagePlus,
} from 'lucide-react';
import GrowArea from '@/components/GrowArea';
import { shrinkAll, pickImages, MAX_SHOTS } from '@/lib/image';
import useCommitments from '@/lib/useCommitments';
import ShotStrip from '@/components/ShotStrip';
import { useTrip } from '@/components/TripProvider';
import { useApp } from '@/components/AppProvider';
import { categoryOf, fmtDayTiny, fmtTime, shortPlace } from '@/lib/util';
import { categoryIcon } from '@/lib/icons';

/**
 * One box for everything you might type at this trip.
 *
 * There used to be two, side by side in the same bar: a magnifying glass that
 * searched what was already there, and a sparkle that changed it. Nobody
 * arrives at a trip knowing which of those their sentence is — "dinner in
 * Kyoto" is a search if it exists and an instruction if it does not, and the
 * only way to find out was to guess a button and start again if you guessed
 * wrong.
 *
 * So there is one input, and the answers are ranked underneath it. Matching
 * runs locally on every keystroke: a few dozen rows, no network, no waiting to
 * be told what you can already see. The model is offered rather than invoked,
 * always as a row you choose, because it costs a minute and a trip-wide edit
 * is not a thing to start by accident.
 *
 * What sits first is decided by shape rather than by intent-detection. A word
 * or two is a lookup, so matches lead; a sentence is an instruction, so the
 * actions do. Nothing is hidden either way.
 */

const ICONS = {
  add_activity: Plus,
  update_activity: Pencil,
  move_activity: CalendarDays,
  delete_activity: Trash2,
  update_trip: Settings,
  shift_times: Clock,
  clear_day: Trash2,
  move_day: CalendarDays,
  edit_many: Pencil,
};

const DESTRUCTIVE = new Set(['delete_activity', 'clear_day']);

/** Past this many words it is a sentence, and a sentence is an instruction. */
const SENTENCE = 4;

/* What every action row says. One table, so the words for a thing live in one
   place rather than inside whichever branch happens to render it. */
const ACTIONS = {
  do: {
    icon: Sparkles,
    label: 'Make this change to the trip',
    hint: 'Shows the edits before anything is saved',
  },
  pack: {
    icon: Backpack,
    label: 'Add it to the packing list',
    hint: 'Straight in, and a number on the front counts as the quantity',
  },
  activity: { icon: Plus, label: 'New activity' },
  packing: { icon: Backpack, label: 'New packing item' },
  trip: { icon: Settings, label: 'Trip details' },
  print: { icon: Printer, label: 'Print or save as PDF' },
};

const EXAMPLES = [
  'Move everything on day 3 to day 5',
  'Make the trip two days longer',
  'Add a hotel each night in Kyoto',
  'Nothing before 10am',
];

/** Nudge a HH:MM by some minutes, staying inside the day. */
/**
 * The keys that were actually set, out of a shape that always carries all.
 *
 * Strict schemas require every property, so a request to set one gate arrives
 * with eleven nulls beside it. Writing those through would blank fields nobody
 * asked about.
 */
function onlySet(details) {
  if (!details || typeof details !== 'object') return {};
  return Object.entries(details).reduce((o, [k, v]) => {
    const val = String(v == null ? '' : v).trim();
    return val ? { ...o, [k]: val } : o;
  }, {});
}

function shiftTime(t, minutes) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  // Clamped rather than rolled over: a stop that silently moves to tomorrow is
  // a worse surprise than one pinned to the end of today.
  const total = Math.max(0, Math.min(23 * 60 + 59, (h * 60) + m + minutes));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * Bulk operations name an intent; this turns one into the edits that carry it
 * out. Doing the expansion here rather than asking the model to enumerate it
 * is the difference between one operation and fifty — and fifty was what kept
 * running long requests out of room.
 */
function expand(op, activities) {
  const onDay = (day) => activities.filter((a) => a.day === day);

  if (op.kind === 'shift_times') {
    const scope = op.day ? onDay(op.day) : activities;
    const by = op.minutes || 0;
    if (!by) return [];
    return scope
      .filter((a) => a.start_time || a.end_time)
      .map((a) => ({
        kind: 'update_activity',
        activity_id: a.id,
        start_time: shiftTime(a.start_time, by),
        end_time: shiftTime(a.end_time, by),
      }));
  }

  if (op.kind === 'clear_day') {
    return onDay(op.day).map((a) => ({ kind: 'delete_activity', activity_id: a.id }));
  }

  if (op.kind === 'edit_many') {
    return (op.items || []).map((it) => {
      const target = activities.find((a) => String(a.id) === String(it.activity_id));
      if (!target) return null;
      let notes = null;
      if (it.note_add) {
        /*
         * Appended, never substituted. The model is not told what an activity
         * already says, so letting it write the notes field outright would
         * quietly replace whatever was there — and "add the train line" is not
         * a request to delete the booking reference someone typed last week.
         */
        const had = (target.notes || '').trim();
        const line = it.note_add.trim();
        notes = !had ? line : had.includes(line) ? had : [had, line].join('\n');
      }
      return {
        kind: 'update_activity',
        activity_id: it.activity_id,
        notes,
        start_time: it.start_time || null,
        end_time: it.end_time || null,
        cost: it.cost == null ? null : it.cost,
        subtype: it.subtype || null,
        details: it.details || null,
      };
    }).filter(Boolean);
  }

  if (op.kind === 'move_day') {
    if (!op.to_day) return [];
    return onDay(op.day)
      .map((a) => ({ kind: 'move_activity', activity_id: a.id, day: op.to_day }));
  }

  return [op];
}

/** Everything about an activity that someone might reasonably type. */
function haystack(a) {
  return [a.title, a.location, a.notes, a.booking_ref, categoryOf(a.category).label]
    .filter(Boolean).join(' ').toLowerCase();
}

/* ---------------------------------------------------------------- wiring --- */

const Ctx = createContext(null);

/** For anything that wants to open the bar — the top bar's button, mainly. */
export function useCommand() {
  return useContext(Ctx) || { open: () => {} };
}

export function CommandTrigger() {
  const { open } = useCommand();
  return (
    <button className="btn ghost sm icon-btn" type="button"
      data-tip="Search or change  ⌘K" aria-label="Search or change this trip"
      onClick={open}>
      <Search size={16} />
    </button>
  );
}

export function CommandProvider({ children }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);

  /*
   * Two ways in from the keyboard, because there are two habits: ⌘K is the
   * command palette everybody has, and "/" is the search box everybody has.
   * They arrive at the same place, which is the point of merging them.
   */
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(
        document.activeElement && document.activeElement.tagName,
      ) || (document.activeElement && document.activeElement.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Ctx.Provider value={value}>
      {children}
      {open ? null : (
        <button className="cmd-pill" type="button" data-tip="Search or change  ⌘K"
          aria-label="Search or change this trip" onClick={() => setOpen(true)}>
          <Sparkles size={15} />
          <span>Search or change…</span>
          <kbd>⌘K</kbd>
        </button>
      )}
      {open ? <CommandBar onClose={() => setOpen(false)} /> : null}
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------- the panel --- */

function CommandBar({ onClose }) {
  const router = useRouter();
  const pathname = usePathname();
  const { supabase, pushToast, fail } = useApp();
  const {
    tripId, trip, activities, requestFocus, request,
    addActivities, addPacking, saveActivity, moveActivity, deleteActivity, updateTrip,
  } = useTrip();

  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null); // { summary, ops }
  const [question, setQuestion] = useState(null); // { ask, header, kind, options }
  const [answers, setAnswers] = useState([]); // every reply so far, in order
  const [picked, setPicked] = useState([]); // multi-select, before Continue
  const [typing, setTyping] = useState(false); // "something else" is open
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const inputRef = useRef(null);
  const askRef = useRef(null);
  const pending = useRef('');

  // Portals need a DOM to aim at, so nothing escapes during SSR.
  useEffect(() => {
    setReady(true);
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 20);
    return () => clearTimeout(t);
  }, []);

  const clearAsk = useCallback(() => {
    setQuestion(null); setPicked([]); setAnswer(''); setTyping(false);
  }, []);

  const startOver = useCallback(() => {
    setText(''); setPlan(null); setAnswers([]); setError(''); setActive(0);
    clearAsk();
    pending.current = '';
    if (inputRef.current) inputRef.current.focus();
  }, [clearAsk]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  /* ------------------------------------------------------------ matching --- */

  /*
   * Pictures attached to the instruction.
   *
   * The same idea as the planner's, for the same reason: what you want changed
   * is often already written down somewhere — a confirmation email, a page of
   * a guidebook, a friend's message. They are read into words first and then
   * handed to the command as if they had been typed, so everything downstream
   * is unchanged.
   */
  const [shots, setShots] = useState([]);
  const fileRef = useRef(null);

  /*
   * What is already in the traveller's own calendar on these dates.
   *
   * Sent with the instruction so that "add my flight from my calendar" has
   * something to refer to. Without it the model was being asked about a
   * calendar it had never been shown, and could only say no or make one up.
   */
  const booked = useCommitments(supabase, trip);

  async function take(files) {
    const picked = pickImages(files);
    if (!picked.length) return;
    setError('');
    const { ok, failed, over } = await shrinkAll(picked, MAX_SHOTS - shots.length);
    if (ok.length) setShots((was) => [...was, ...ok]);
    if (over > 0) setError(`${MAX_SHOTS} pictures is the most I can read at once.`);
    else if (failed.length) setError(failed[0]);
  }

  const term = text.trim().toLowerCase();
  const words = term ? term.split(/\s+/) : [];

  const hits = useMemo(() => {
    if (!term) return [];
    // Every word must appear somewhere, so "ramen shibuya" narrows rather than
    // widens the way a single-string match would.
    return activities
      .filter((a) => { const h = haystack(a); return words.every((w) => h.includes(w)); })
      .sort((a, b) => (a.day === b.day
        ? String(a.start_time || '').localeCompare(String(b.start_time || ''))
        : String(a.day).localeCompare(String(b.day))))
      .slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, activities]);

  /*
   * The whole answer, in the order it should be read. A sentence leads with
   * what to do about it; a word or two leads with what it already matches.
   */
  const rows = useMemo(() => {
    /* A picture is an instruction, not a search term — there is nothing in the
       trip it could match against. */
    if (shots.length) return [{ id: 'do', kind: 'do' }];
    // Nothing typed yet: the things someone might have opened this to start.
    if (!term) {
      return [
        { id: 'new-act', kind: 'start', arg: 'activity' },
        { id: 'new-pack', kind: 'start', arg: 'packing' },
        { id: 'trip', kind: 'start', arg: 'trip' },
        { id: 'print', kind: 'print' },
      ];
    }
    const found = hits.map((a) => ({ id: `a-${a.id}`, kind: 'act', act: a }));
    const acts = [
      { id: 'do', kind: 'do' },
      { id: 'pack', kind: 'pack' },
    ];
    return words.length >= SENTENCE || !found.length
      ? [...acts, ...found] : [...found, ...acts];
  }, [term, hits, words.length, shots.length]);

  useEffect(() => { setActive(0); }, [term]);

  const itinerary = `/trips/${tripId}/itinerary`;
  const packingTab = `/trips/${tripId}/packing`;

  /** Go to an activity: the itinerary scrolls to it and opens it. */
  function go(a) {
    onClose();
    requestFocus(a.id);
    if (pathname !== itinerary) router.push(itinerary);
  }

  /* -------------------------------------------------------------- doing --- */

  /**
   * Send the instruction, plus every answer given to every question so far.
   *
   * `reply` is a new answer being added, or nothing for a first attempt. The
   * whole run goes each time because an answer is meaningless without the
   * question it belongs to, and a second question would otherwise arrive with
   * the first answer already forgotten.
   */
  async function run(reply) {
    const first = reply == null;
    let instruction = first ? text.trim() : pending.current;
    if (!instruction && !(first && shots.length)) return;
    const said = first ? [] : [...answers, reply];
    setAnswers(said);
    setBusy(true); setError(''); clearAsk();

    /*
     * Pictures become words before anything else happens, so a picture nobody
     * can read fails here — with a sentence about the picture — rather than
     * being handed to the editor as an empty instruction.
     */
    if (first && shots.length) {
      try {
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: shots.map((sh) => sh.url), said: instruction }),
        });
        const seen = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(seen.error || 'Those pictures could not be read.');
          setBusy(false);
          return;
        }
        const from = shots.length === 1 ? 'From an attached picture:' : 'From attached pictures:';
        instruction = instruction
          ? `${instruction}\n\n${from}\n${seen.brief}`
          : `Add this to the trip.\n\n${from}\n${seen.brief}`;
        pending.current = instruction;
      } catch (e) {
        setError('The connection dropped while reading. Try again.');
        setBusy(false);
        return;
      }
    }
    /*
     * A trip-wide edit genuinely takes a minute or two. Left to the default,
     * a stalled request hangs forever and then reports the same shrug as a
     * server fault — this gives up deliberately and says something you can
     * act on.
     */
    const stop = new AbortController();
    const gaveUp = setTimeout(() => stop.abort(), 180000);
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        signal: stop.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          answers: said,
          trip: {
            name: trip.name,
            destination: trip.destination,
            start_date: trip.start_date,
            end_date: trip.end_date,
            currency: trip.currency,
            budget: trip.budget,
          },
          // Flattened out of the day-keyed shape the itinerary wants.
          calendar: Object.values(booked).flat().slice(0, 40),
          activities: activities.map((a) => ({
            id: a.id,
            day: a.day,
            start_time: a.start_time,
            title: a.title,
            category: a.category,
            // "Asakusa, Tokyo" rather than the full postal address Google
            // returned: enough to reason about, a third of the tokens, and
            // every token in the question is time before the answer starts.
            location: shortPlace(a.location),
            cost: a.cost,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not work that out.'); return; }
      if (!body.understood && body.question) {
        pending.current = instruction;
        setQuestion(body.question);
        setTyping(body.question.kind === 'text');
        setTimeout(() => askRef.current && askRef.current.focus(), 0);
        return;
      }
      if (!body.ops.length) {
        setError('Nothing in the trip needed changing for that.');
        return;
      }
      setPlan({ summary: body.summary, ops: body.ops });
    } catch (e) {
      setError(e.name === 'AbortError'
        ? 'That took too long to work out. Try asking for a few days at a time.'
        : 'Something went wrong. Please try again later.');
    } finally {
      clearTimeout(gaveUp);
      setBusy(false);
    }
  }

  /**
   * Straight onto the packing list, with no model in the way.
   *
   * A number on the front is a quantity, and reading it off is arithmetic
   * rather than judgement — worth doing, and not worth a round trip to do it.
   */
  async function pack() {
    const said = text.trim();
    if (!said || busy) return;
    const m = said.match(/^(\d{1,3})\s*x?\s+(.+)$/);
    const label = ((m ? m[2] : said)).trim().slice(0, 120);
    setBusy(true);
    try {
      await addPacking({ label, category: 'general', qty: m ? Number(m[1]) : 1 });
      pushToast(`Added “${label}” to the packing list.`);
      onClose();
      if (pathname !== packingTab) router.push(packingTab);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  /** Start something that belongs to the page underneath. */
  function start(kind) {
    onClose();
    if (kind === 'packing' && pathname !== packingTab) router.push(packingTab);
    request(kind);
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    const byId = new Map(activities.map((a) => [String(a.id), a]));
    const additions = [];
    let done = 0;

    try {
      for (const op of plan.ops.flatMap((o) => expand(o, activities))) {
        if (op.kind === 'add_activity') {
          additions.push({
            day: op.day || trip.start_date,
            title: op.title || 'Untitled',
            start_time: op.start_time,
            end_time: op.end_time,
            category: op.category || 'sightseeing',
            subtype: op.category === 'transport' ? op.subtype || null : null,
            details: op.category === 'transport' ? onlySet(op.details) : {},
            location: op.location || '',
            cost: op.cost || 0,
            notes: op.notes || '',
          });
          done += 1;
        } else if (op.kind === 'update_trip') {
          const patch = {};
          if (op.trip_name) patch.name = op.trip_name;
          if (op.destination != null) patch.destination = op.destination;
          if (op.start_date) patch.start_date = op.start_date;
          if (op.end_date) patch.end_date = op.end_date;
          if (op.currency) patch.currency = op.currency;
          if (op.budget != null) patch.budget = op.budget;
          if (Object.keys(patch).length) {
            await updateTrip(patch); // eslint-disable-line no-await-in-loop
            done += 1;
          }
        } else {
          const target = byId.get(String(op.activity_id));
          if (!target) continue;
          if (op.kind === 'delete_activity') {
            await deleteActivity(target); // eslint-disable-line no-await-in-loop
          } else if (op.kind === 'move_activity') {
            await moveActivity(target, op.day); // eslint-disable-line no-await-in-loop
          } else {
            const patch = { ...target };
            if (op.title != null) patch.title = op.title;
            if (op.start_time !== null) patch.start_time = op.start_time;
            if (op.end_time !== null) patch.end_time = op.end_time;
            if (op.category != null) patch.category = op.category;
            if (op.subtype != null) patch.subtype = op.subtype;
            /*
             * Merged, not replaced. Setting the gate on a flight should not
             * wipe the seat number somebody typed last week, and the model is
             * only ever told to send what it means to change.
             */
            if (op.details) {
              patch.details = { ...(target.details || {}), ...onlySet(op.details) };
            }
            if (op.location != null) patch.location = op.location;
            if (op.cost != null) patch.cost = op.cost;
            if (op.notes != null) patch.notes = op.notes;
            if (op.day) patch.day = op.day;
            await saveActivity(patch); // eslint-disable-line no-await-in-loop
          }
          done += 1;
        }
      }

      if (additions.length) await addActivities(additions);
      pushToast(`${done} change${done === 1 ? '' : 's'} applied.`);
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  function choose(row) {
    if (!row || busy) return;
    if (row.kind === 'act') go(row.act);
    else if (row.kind === 'do') run();
    else if (row.kind === 'pack') pack();
    else if (row.kind === 'start') start(row.arg);
    else if (row.kind === 'print') { onClose(); setTimeout(() => window.print(), 60); }
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); choose(rows[active]);
    }
  }

  if (!trip || !ready) return null;

  // The preview lists intents; this is how many activities they land on.
  const edits = plan ? plan.ops.flatMap((o) => expand(o, activities)).length : 0;
  const answered = !!question || !!plan;
  const showList = !answered && !busy;

  /** A row of the answer, whichever kind it is. */
  const row = (r, i) => {
    const on = i === active;
    const pick = { onMouseEnter: () => setActive(i), onMouseDown: (e) => { e.preventDefault(); choose(r); } };
    if (r.kind === 'act') {
      const cat = categoryOf(r.act.category);
      const Icon = categoryIcon(cat.id);
      const place = shortPlace(r.act.location);
      return (
        <li key={r.id} role="option" aria-selected={on}
          className={`ck-row${on ? ' is-active' : ''}`} {...pick}>
          <span className={`catico cat-${cat.id}`} aria-hidden="true"><Icon size={14} /></span>
          <span className="ck-main">
            <span className="ck-title">{r.act.title}</span>
            <span className="tiny dim">
              {fmtDayTiny(r.act.day)}
              {r.act.start_time ? ` · ${fmtTime(r.act.start_time)}` : ''}
              {place ? ` · ${place}` : ''}
            </span>
          </span>
        </li>
      );
    }
    const said = ACTIONS[r.kind === 'start' ? r.arg : r.kind];
    const Icon = said.icon;
    return (
      <li key={r.id} role="option" aria-selected={on}
        className={`ck-row is-action${on ? ' is-active' : ''}`} {...pick}>
        <span className="ck-ico" aria-hidden="true"><Icon size={15} /></span>
        <span className="ck-main">
          <span className="ck-title">{said.label}</span>
          {said.hint ? <span className="tiny dim">{said.hint}</span> : null}
        </span>
      </li>
    );
  };

  return createPortal((
    <div className="ck-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ck card" role="dialog" aria-modal="true"
        aria-label="Search or change this trip"
        onPaste={(e) => {
          if (pickImages(e.clipboardData && e.clipboardData.files).length) {
            e.preventDefault(); take(e.clipboardData.files);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); take(e.dataTransfer && e.dataTransfer.files); }}
      >
        <div className="ck-top">
          {busy ? <Loader2 size={17} className="spin ck-ico-lead" />
            : <Sparkles size={17} className="ck-ico-lead" />}
          <GrowArea
            ref={inputRef}
            className="ck-in"
            value={text}
            disabled={busy}
            placeholder="Search this trip, or say what to change…"
            aria-label="Search this trip, or say what to change"
            onKeyDown={onKeyDown}
            onChange={(e) => {
              setText(e.target.value); setError(''); setPlan(null);
              // A new sentence is a new conversation; the old answers were
              // about a question nobody is being asked any more.
              setAnswers([]); clearAsk(); pending.current = '';
            }}
          />
          {answered && !busy ? (
            <button className="btn ghost sm icon-btn" type="button"
              data-tip="Start over" aria-label="Start over" onClick={startOver}>
              <RotateCcw size={15} />
            </button>
          ) : null}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
          <button className="btn ghost sm icon-btn" type="button"
            disabled={busy || shots.length >= MAX_SHOTS}
            data-tip={shots.length >= MAX_SHOTS ? `${MAX_SHOTS} is the limit` : 'Add photos'}
            aria-label="Add photos"
            onClick={() => fileRef.current && fileRef.current.click()}>
            <ImagePlus size={15} />
          </button>
          <button className="btn ghost sm icon-btn" type="button"
            data-tip="Close  Esc" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>

        <ShotStrip className="ck-shots" shots={shots} disabled={busy}
          onRemove={(i) => setShots((was) => was.filter((_, at) => at !== i))} />

        {error ? <div className="err ck-err">{error}</div> : null}

        {busy ? (
          <p className="ck-empty">Working it out — a whole-trip change can take a minute.</p>
        ) : null}

        {showList ? (
          <ul className="ck-list" role="listbox" aria-label="Results">
            {rows.map(row)}
          </ul>
        ) : null}

        {showList && !term ? (
          <div className="ck-blank">
            <p className="ck-sec">Or say what to change</p>
            <div className="cmd-examples">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="samplechip"
                  onClick={() => { setText(x); inputRef.current.focus(); }}>{x}</button>
              ))}
            </div>
          </div>
        ) : null}

        {showList && term ? (
          <p className="ck-foot">
            <CornerDownLeft size={12} />
            {hits.length
              ? `${hits.length} match${hits.length === 1 ? '' : 'es'} in this trip`
              : 'Nothing in this trip matches — the model can still do it'}
          </p>
        ) : null}

        {/*
          * Answers, not a blank box.
          *
          * The question the model asks is nearly always a choice between
          * readings it has already worked out — offering them turns a decision
          * into one tap and removes the second round that a vaguely worded
          * reply used to cost.
          */}
        {question ? (
          <div className="cmdq ck-pad">
            {question.header ? <span className="cmdq-head">{question.header}</span> : null}
            <p className="cmdq-ask"><Sparkles size={14} aria-hidden="true" />{question.ask}</p>

            {typing ? (
              <form className="cmdq-row"
                onSubmit={(e) => { e.preventDefault(); if (answer.trim()) run(answer.trim()); }}>
                <GrowArea ref={askRef} value={answer} disabled={busy}
                  placeholder="Say what you meant…"
                  onSubmit={() => { if (answer.trim()) run(answer.trim()); }}
                  onChange={(e) => setAnswer(e.target.value)} />
                <button className="btn sm primary" type="submit" disabled={busy || !answer.trim()}>
                  Continue
                </button>
                {question.kind !== 'text' ? (
                  <button className="btn sm ghost" type="button" disabled={busy}
                    onClick={() => { setTyping(false); setAnswer(''); }}>
                    <ArrowLeft size={14} /> Back
                  </button>
                ) : null}
              </form>
            ) : (
              <>
                <div className="cmdq-opts" role={question.kind === 'multi' ? 'group' : 'list'}>
                  {question.options.map((o) => {
                    const on = picked.includes(o.label);
                    return (
                      <button key={o.label} type="button" disabled={busy}
                        aria-pressed={question.kind === 'multi' ? on : undefined}
                        className={`cmdq-opt${on ? ' is-on' : ''}`}
                        onClick={() => {
                          if (question.kind !== 'multi') { run(o.label); return; }
                          setPicked((p) => (on ? p.filter((x) => x !== o.label) : [...p, o.label]));
                        }}>
                        {question.kind === 'multi' ? (
                          <span className="cmdq-box" aria-hidden="true">
                            {on ? <Check size={12} /> : null}
                          </span>
                        ) : null}
                        <span className="cmdq-opt-main">
                          <span className="cmdq-opt-label">{o.label}</span>
                          {o.detail ? <span className="cmdq-opt-detail">{o.detail}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="cmdq-foot">
                  <button type="button" className="linkbtn" disabled={busy}
                    onClick={() => {
                      setTyping(true);
                      setTimeout(() => askRef.current && askRef.current.focus(), 0);
                    }}>
                    Something else…
                  </button>
                  {question.kind === 'multi' ? (
                    <button className="btn sm primary" type="button"
                      disabled={busy || !picked.length}
                      onClick={() => run(picked.join(', '))}>
                      Continue{picked.length ? ` · ${picked.length}` : ''}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}

        {plan ? (
          <div className="cmd-plan ck-pad">
            {plan.summary ? <p className="small muted cmd-summary">{plan.summary}</p> : null}
            <ul className="cmd-ops">
              {plan.ops.map((op, i) => {
                const Icon = ICONS[op.kind] || Pencil;
                const touches = expand(op, activities).length;
                return (
                  <li key={`${op.kind}-${i}`}
                    className={DESTRUCTIVE.has(op.kind) ? 'is-destructive' : ''}>
                    <Icon size={14} />
                    <span>{op.describe}</span>
                    {/* A bulk line stands for many edits — say how many, or
                        "clear day 4" reads like a single small change. */}
                    {touches > 1 ? <span className="cmd-day">{touches} stops</span>
                      : op.day ? <span className="cmd-day">{fmtDayTiny(op.day)}</span> : null}
                  </li>
                );
              })}
            </ul>
            <div className="cmd-actions">
              <span className="tiny dim">
                {edits} change{edits === 1 ? '' : 's'} · nothing saved yet
              </span>
              <button className="btn sm" onClick={() => setPlan(null)} disabled={busy}>Discard</button>
              <button className="btn sm primary" onClick={apply} disabled={busy}>
                {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Apply
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  ), document.body);
}
