'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles, Loader2, X, Check, ArrowUp, Trash2, CalendarDays, Pencil, Plus, Settings,
} from 'lucide-react';
import { useTrip } from '@/components/TripProvider';
import { useApp } from '@/components/AppProvider';
import { fmtDayTiny } from '@/lib/util';

const ICONS = {
  add_activity: Plus,
  update_activity: Pencil,
  move_activity: CalendarDays,
  delete_activity: Trash2,
  update_trip: Settings,
};

const EXAMPLES = [
  'Move everything on day 3 to day 5',
  'Make the trip two days longer',
  'Add a hotel each night in Kyoto',
  'Nothing before 10am',
];

/**
 * One box that edits anything in the trip.
 *
 * It never applies straight away. The model returns a list of concrete edits,
 * each described in a line you can check, and nothing touches the database
 * until you approve it — an instruction like "clear day 4" is easy to say and
 * expensive to get wrong.
 */
export default function TripCommand() {
  const { pushToast, fail } = useApp();
  const {
    trip, activities,
    addActivities, saveActivity, moveActivity, deleteActivity, updateTrip,
  } = useTrip();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null); // { summary, ops }
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const pending = useRef('');

  const reset = useCallback(() => {
    setText(''); setPlan(null); setQuestion(''); setAnswer(''); setError('');
    pending.current = '';
  }, []);

  // Cmd/Ctrl+K from anywhere in the trip, Escape to dismiss.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
      } else if (e.key === 'Escape' && open && !busy) {
        setOpen(false);
        reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, reset]);

  async function ask(clarification) {
    const instruction = clarification ? pending.current : text.trim();
    if (!instruction) return;
    setBusy(true); setError(''); setQuestion('');
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          answer: clarification || '',
          trip: {
            name: trip.name,
            destination: trip.destination,
            start_date: trip.start_date,
            end_date: trip.end_date,
            currency: trip.currency,
            budget: trip.budget,
          },
          activities: activities.map((a) => ({
            id: a.id,
            day: a.day,
            start_time: a.start_time,
            title: a.title,
            category: a.category,
            location: a.location,
            cost: a.cost,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not work that out.'); return; }
      if (!body.understood && body.question) {
        pending.current = instruction;
        setQuestion(body.question);
        return;
      }
      if (!body.ops.length) {
        setError('Nothing in the trip needed changing for that.');
        return;
      }
      setPlan({ summary: body.summary, ops: body.ops });
    } catch (e) {
      setError('Could not reach the planner.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    const byId = new Map(activities.map((a) => [String(a.id), a]));
    const additions = [];
    let done = 0;

    try {
      for (const op of plan.ops) {
        if (op.kind === 'add_activity') {
          additions.push({
            day: op.day || trip.start_date,
            title: op.title || 'Untitled',
            start_time: op.start_time,
            end_time: op.end_time,
            category: op.category || 'sightseeing',
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
      setOpen(false);
      reset();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  if (!trip) return null;

  if (!open) {
    // At phone widths this is a round icon button and the label is hidden, so
    // the accessible name has to be stated rather than read off the text.
    return (
      <button className="cmd-pill" type="button" aria-label="Change anything in this trip"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
        }}>
        <Sparkles size={15} />
        <span>Change anything…</span>
        <kbd>⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="cmd-wrap">
      <div className="cmd card">
        <form className="cmd-top" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <Sparkles size={16} className="cmd-spark" />
          <input
            ref={inputRef}
            className="cmd-input"
            value={text}
            disabled={busy}
            placeholder="Change anything in this trip…"
            onChange={(e) => { setText(e.target.value); setError(''); setPlan(null); }}
          />
          {busy ? <Loader2 size={16} className="spin" />
            : text.trim() ? (
              <button className="qa-send cmd-send" type="submit" aria-label="Work it out">
                <ArrowUp size={15} />
              </button>
            ) : null}
          <button className="btn ghost sm icon-btn" type="button" aria-label="Close"
            onClick={() => { setOpen(false); reset(); }}><X size={15} /></button>
        </form>

        {!plan && !question && !error && !busy ? (
          <div className="cmd-examples">
            {EXAMPLES.map((x) => (
              <button key={x} type="button" className="samplechip"
                onClick={() => { setText(x); inputRef.current.focus(); }}>{x}</button>
            ))}
          </div>
        ) : null}

        {error ? <div className="err" style={{ marginTop: 4 }}>{error}</div> : null}

        {question ? (
          <form className="qa-ask" style={{ marginTop: 10 }}
            onSubmit={(e) => { e.preventDefault(); if (answer.trim()) ask(answer.trim()); }}>
            <div className="qa-ask-q"><Sparkles size={14} /><span>{question}</span></div>
            <div className="qa-ask-row">
              <input className="input" value={answer} disabled={busy}
                placeholder="Answer, or say what you meant…"
                onChange={(e) => setAnswer(e.target.value)} />
              <button className="btn sm primary" type="submit" disabled={busy || !answer.trim()}>
                Continue
              </button>
            </div>
          </form>
        ) : null}

        {plan ? (
          <div className="cmd-plan">
            {plan.summary ? <p className="small muted cmd-summary">{plan.summary}</p> : null}
            <ul className="cmd-ops">
              {plan.ops.map((op, i) => {
                const Icon = ICONS[op.kind] || Pencil;
                return (
                  <li key={`${op.kind}-${i}`}
                    className={op.kind === 'delete_activity' ? 'is-destructive' : ''}>
                    <Icon size={14} />
                    <span>{op.describe}</span>
                    {op.day ? <span className="cmd-day">{fmtDayTiny(op.day)}</span> : null}
                  </li>
                );
              })}
            </ul>
            <div className="cmd-actions">
              <span className="tiny dim">
                {plan.ops.length} change{plan.ops.length === 1 ? '' : 's'} · nothing saved yet
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
  );
}
