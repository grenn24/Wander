'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Plus, X, RotateCw } from 'lucide-react';
import { categoryOf, fmtTime } from '@/lib/util';
import { categoryIcon } from '@/lib/icons';

/**
 * Asks for ideas for one day and shows them as a reviewable list. Nothing is
 * written until the traveller picks — a planner that silently inserts things
 * you did not choose is worse than no planner.
 */
export default function AiSuggest({ trip, day, dayLabel, existing, seed = '', onAdd, onClose }) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [ideas, setIdeas] = useState([]);
  const [taken, setTaken] = useState({});
  // Whatever was typed into the day's add line is what they were after;
  // asking for ideas should start from it rather than ignore it.
  const [note, setNote] = useState(seed);
  const ran = useRef(false);

  async function ask(extra) {
    setBusy(true); setError(''); setIdeas([]);
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: trip.destination || trip.name,
          currency: trip.currency,
          dayLabel,
          note: extra || '',
          existing: existing.map((a) => ({
            title: a.title, start_time: a.start_time, location: a.location,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not get suggestions.'); return; }
      setIdeas(body.activities || []);
    } catch (e) {
      setError('Something went wrong. Please try again later.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    ask(seed);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function take(idea, i) {
    setTaken((t) => ({ ...t, [i]: 'busy' }));
    await onAdd([{ ...idea, day }]);
    setTaken((t) => ({ ...t, [i]: 'done' }));
  }

  async function takeAll() {
    const left = ideas.filter((_, i) => taken[i] !== 'done');
    if (!left.length) return;
    setBusy(true);
    await onAdd(left.map((idea) => ({ ...idea, day })));
    const all = {};
    ideas.forEach((_, i) => { all[i] = 'done'; });
    setTaken(all);
    setBusy(false);
  }

  return (
    <div className="suggest card">
      <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
        <div className="suggest-head">
          <span className="suggest-ico" aria-hidden="true"><Sparkles size={15} /></span>
          <div>
            <strong className="small">Ideas for {dayLabel}</strong>
            <div className="tiny dim">Nothing is added until you pick.</div>
          </div>
        </div>
        <button className="btn ghost sm icon-btn" onClick={onClose}
          title="Close suggestions" aria-label="Close suggestions">
          <X size={15} />
        </button>
      </div>

      {busy && !ideas.length ? (
        <div className="small muted mapside-busy">
          <Loader2 size={14} className="spin" /> Thinking about {dayLabel}…
        </div>
      ) : null}

      {error ? (
        <>
          <div className="err" style={{ marginTop: 0 }}>{error}</div>
          <div className="chiprow" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => ask(note)}><RotateCw size={14} /> Try again</button>
          </div>
        </>
      ) : null}

      {ideas.length ? (
        <>
          <div className="suggest-list">
            {ideas.map((idea, i) => {
              const cat = categoryOf(idea.category);
              const Icon = categoryIcon(cat.id);
              const state = taken[i];
              return (
                <div className={`suggest-item${state === 'done' ? ' is-done' : ''}`} key={`${idea.title}-${i}`}>
                  <span className={`catico cat-${cat.id}`} aria-hidden="true"><Icon size={13} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="suggest-title">
                      {idea.start_time ? <span className="dim mono">{fmtTime(idea.start_time)} </span> : null}
                      {idea.title}
                    </div>
                    {idea.notes ? <div className="tiny dim">{idea.notes}</div> : null}
                    {idea.location ? <div className="tiny dim">{idea.location}</div> : null}
                  </div>
                  <button className="btn sm" disabled={!!state}
                    onClick={() => take(idea, i)}
                    title={`Add ${idea.title} to this day`} aria-label={`Add ${idea.title}`}>
                    {state === 'busy' ? <Loader2 size={14} className="spin" />
                      : state === 'done' ? 'Added' : <Plus size={14} />}
                  </button>
                </div>
              );
            })}
          </div>

          <form className="suggest-more" onSubmit={(e) => { e.preventDefault(); ask(note); }}>
            <input className="input" value={note} placeholder="Ask for something else — cheaper, rainy day, with kids…"
              onChange={(e) => setNote(e.target.value)} />
            <button className="btn sm" type="submit" disabled={busy}>
              {busy ? <Loader2 size={14} className="spin" /> : <RotateCw size={14} />}
            </button>
            <button className="btn sm primary" type="button" onClick={takeAll} disabled={busy}>
              Add all
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
