'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Sparkles, Plus, X } from 'lucide-react';
import { parseQuickAdd } from '@/lib/util';
import { authHeader } from '@/lib/supabase';
import { checkNewEntries } from '@/lib/entryChecks';

/**
 * The line at the foot of each day. You write what you mean — "dinner at that
 * ramen place around 7, maybe 2000 yen" — and it becomes an entry, or one entry
 * per place when the line names several. When one short question would
 * genuinely change the result it asks instead of guessing.
 *
 * Falls back to the local time-prefix parser when the planner is unconfigured,
 * so the field always does something useful.
 */
export default function QuickAdd({
  day, label, trip, existing, onCreate, onSuggest, onManual, suggestOpen,
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  /*
   * The sentence in this box is the brief for the suggestions panel, so
   * closing the panel ends it. Leaving it behind meant the next thing typed
   * here was appended to a request already answered and dismissed.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !suggestOpen) setText('');
    wasOpen.current = suggestOpen;
  }, [suggestOpen]);
  const answerRef = useRef(null);
  const pending = useRef('');

  function reset() {
    setText(''); setQuestion(''); setAnswer(''); setError('');
    pending.current = '';
    if (inputRef.current) inputRef.current.focus();
  }

  async function submit(e, clarification) {
    if (e) e.preventDefault();
    const raw = clarification ? pending.current : text.trim();
    if (!raw) return;

    setBusy(true); setError('');
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          text: raw,
          answer: clarification || '',
          destination: trip.destination || trip.name,
          currency: trip.currency,
          dayLabel: label,
          existing: existing.map((a) => ({
            title: a.title, start_time: a.start_time, end_time: a.end_time, location: a.location,
          })),
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        // No planner configured: the local parser still understands "9am Ramen".
        if (body.code === 'no_key') {
          const { title, start_time } = parseQuickAdd(raw);
          await onCreate([{ day, title: title || raw, start_time, category: 'sightseeing', cost: 0 }]);
          reset();
          return;
        }
        setError(body.error || 'Could not read that.');
        return;
      }

      if (!body.understood && body.question) {
        pending.current = raw;
        setQuestion(body.question);
        setTimeout(() => answerRef.current && answerRef.current.focus(), 0);
        return;
      }

      // One line can name several places; each becomes its own stop, pinned
      // to its own address.
      const drafts = (body.activities || (body.activity ? [body.activity] : []))
        .map((a) => ({ ...a, day }));
      if (!drafts.length) { setError('Could not read that.'); return; }
      // Its flight made real and its place pinned, as every new entry is.
      await onCreate(await checkNewEntries(drafts, {
        bias: trip.destination || '', said: raw, currency: trip.currency || '',
      }));
      reset();
    } catch (err) {
      setError('Something went wrong. Please try again later.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qa">
      <form className="qa-row" onSubmit={submit}>
        <div className="qa-field">
          <input
            ref={inputRef}
            className="qa-input"
            value={text}
            disabled={busy}
            aria-label={`Add something to ${label}`}
            placeholder="Describe what you want to add…"
            onChange={(e) => { setText(e.target.value); setError(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setText(''); e.currentTarget.blur(); }
            }}
          />
          {text.trim() && !busy ? (
            <button className="qa-send" type="submit" data-tip="Add this  ↵" aria-label="Add this">
              <ArrowUp size={15} />
            </button>
          ) : null}
          {busy ? <Loader2 size={15} className="spin qa-spin" aria-label="Working" /> : null}
        </div>

        <button className="btn sm" type="button" aria-pressed={suggestOpen}
          onClick={() => onSuggest(text.trim())}>
          <Sparkles size={15} /> Suggest
        </button>
        <button className="btn sm" type="button" onClick={() => { onManual(day, text.trim()); setText(''); }}>
          <Plus size={15} /> Add
        </button>
      </form>

      {question ? (
        <form
          className="qa-ask"
          onSubmit={(e) => { e.preventDefault(); const a = answer.trim(); if (a) submit(null, a); }}
        >
          <div className="qa-ask-q">
            <Sparkles size={14} />
            <span>{question}</span>
          </div>
          <div className="qa-ask-row">
            <input
              ref={answerRef}
              className="input"
              value={answer}
              disabled={busy}
              placeholder="Answer, or just say what you meant…"
              onChange={(e) => setAnswer(e.target.value)}
            />
            <button className="btn sm primary" type="submit" disabled={busy || !answer.trim()}>
              {busy ? <Loader2 size={14} className="spin" /> : 'Continue'}
            </button>
            <button className="btn ghost sm icon-btn" type="button" data-tip="Cancel" aria-label="Cancel"
              onClick={reset}><X size={14} /></button>
          </div>
        </form>
      ) : null}

      {error ? <div className="err qa-err">{error}</div> : null}
    </div>
  );
}
