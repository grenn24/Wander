'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Sparkles, Square, SquarePen } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import { useTrip } from '@/components/TripProvider';
import GrowArea from '@/components/GrowArea';
import AskAnswer from '@/components/AskAnswer';
import { useAskThread } from '@/components/askThread';
import { askSuggestions } from '@/lib/tripAsk';
import { zonedNow } from '@/lib/util';
import g from './Guides.module.css';
import s from './TripAsk.module.css';

/**
 * Ask: questions about the trip, answered by a model that has read all of it.
 *
 * It reads the plan (days, stops, costs, packing, notes), searches the web for
 * what changes, and writes back in Markdown — tables, lists, links to the
 * trip's own stops, and maps. It cannot change anything; edits stay with the
 * command bar, where every one is shown before it is saved.
 */
export default function TripAsk({ trip, days, activities }) {
  const router = useRouter();
  const { supabase } = useApp();
  const { request } = useTrip();
  const { messages, busy, ask, again, stop, clear } = useAskThread(trip.id);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const input = useRef(null);
  const end = useRef(null);
  const pinned = useRef(true);

  const today = useMemo(() => zonedNow(trip.timezone || undefined).date, [trip.timezone]);
  const suggestions = useMemo(() => askSuggestions(trip, activities, today), [trip, activities, today]);

  async function token() {
    const { data } = supabase ? await supabase.auth.getSession() : { data: null };
    return data && data.session && data.session.access_token;
  }

  async function send(said) {
    const q = String(said || '').trim();
    if (!q || busy) return;
    const t = await token();
    if (!t) { setError('Sign in again to ask about this trip.'); return; }
    setError('');
    setText('');
    pinned.current = true;
    ask(q, t);
  }

  async function askAgain() {
    const t = await token();
    if (!t) { setError('Sign in again to ask about this trip.'); return; }
    pinned.current = true;
    again(t);
  }

  /*
   * Follow the answer down while it is written, unless the reader has
   * scrolled up to read something else: then the page stays where they put
   * it, the way it would in any other conversation.
   */
  useEffect(() => {
    const onScroll = () => {
      const room = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      pinned.current = room < 160;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const last = messages[messages.length - 1];
  useEffect(() => {
    if (pinned.current && end.current) end.current.scrollIntoView({ block: 'end' });
  }, [messages.length, last && last.content, last && last.searching]);

  useEffect(() => { if (input.current) input.current.focus({ preventScroll: true }); }, []);

  const openStop = useCallback((a) => {
    if (a && a.id) router.push(`/trips/${trip.id}/itinerary?focus=${encodeURIComponent(a.id)}`);
  }, [router, trip.id]);

  // "Add to trip" on a place an answer mapped: the usual editor, filled in.
  const addPlace = useCallback((p) => {
    request('activity', {
      title: p.name,
      location: p.location || p.label || p.name,
      lat: p.lat,
      lng: p.lng,
      category: p.category || 'sightseeing',
      photo_ref: p.photo_ref,
      place_id: p.place_id,
    });
  }, [request]);

  const empty = !messages.length;

  return (
    <div className={s.page}>
      <div className="page-head spread">
        <div>
          <h2>Ask</h2>
          <div className="small muted">Questions about {trip.name}, answered from the plan and the web.</div>
        </div>
        {!empty ? (
          <div className="page-head-acts">
            <button type="button" className="btn ghost sm" onClick={() => { clear(); setError(''); input.current?.focus(); }}>
              <SquarePen size={15} /> New chat
            </button>
          </div>
        ) : null}
      </div>

      {empty ? (
        <div className={s.intro}>
          <p className="muted">
            Ask anything about this trip. Answers read the whole plan, link to its stops, and draw maps when a map helps.
          </p>
          <div className="cmd-examples">
            {suggestions.map((q) => (
              <button key={q} type="button" className="samplechip" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className={s.log} aria-live="polite">
          {messages.map((m, i) => (m.role === 'user' ? (
            <div key={m.id} className={`${g.askMe} ${s.me}`}><p>{m.content}</p></div>
          ) : (
            <AskAnswer key={m.id} message={m} last={i === messages.length - 1 && !busy}
              trip={trip} days={days} activities={activities}
              onOpenStop={openStop} onAddPlace={addPlace} onAgain={askAgain} />
          )))}
        </div>
      )}
      <div ref={end} className={s.end} />

      <div className={s.dock}>
        {error ? <p className="err" role="alert">{error}</p> : null}
        <form className="planbox-field" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <span className="planbox-spark" aria-hidden="true"><Sparkles size={17} /></span>
          <GrowArea ref={input} className={`planbox-input ${s.input}`} value={text} maxLength={2000}
            aria-label="Your question" placeholder={empty ? 'Ask about this trip' : 'Ask a follow-up'}
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)} onSubmit={() => send(text)} />
          {busy ? (
            <button type="button" className="btn planbox-go" aria-label="Stop" data-tip="Stop" onClick={stop}>
              <Square size={14} />
            </button>
          ) : (
            <button type="submit" className="btn primary planbox-go" aria-label="Ask" disabled={!text.trim()}>
              <ArrowUp size={18} />
            </button>
          )}
        </form>
        <p className={`small muted ${s.fine}`}>Answers can be wrong. Check times and prices before you rely on them.</p>
      </div>
    </div>
  );
}
