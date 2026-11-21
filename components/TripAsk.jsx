'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, History, Sparkles, Square, SquarePen, Trash2 } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import { useTrip } from '@/components/TripProvider';
import GrowArea from '@/components/GrowArea';
import Popover from '@/components/Popover';
import ConfirmModal from '@/components/ConfirmModal';
import useKept from '@/components/useKept';
import AskAnswer from '@/components/AskAnswer';
import { useAskThread } from '@/components/askThread';
import { askGreetings, askSuggestions } from '@/lib/tripAsk';
import { zonedNow } from '@/lib/util';
import g from './Guides.module.css';
import s from './TripAsk.module.css';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When a chat was last added to: a time today, a date otherwise. */
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
  }
  return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/**
 * The trip Assistant: questions about the trip, answered by a model that has
 * read all of it. A trip opens here.
 *
 * It reads the plan (days, stops, costs, packing, notes), searches the web for
 * what changes, and writes back in Markdown — tables, lists, links to the
 * trip's own stops, and maps. It cannot change anything; edits stay with the
 * command bar, where every one is shown before it is saved. Conversations are
 * kept for the person who had them, and nobody else on the trip sees them.
 */
export default function TripAsk({ trip, days, activities }) {
  const router = useRouter();
  const { supabase } = useApp();
  const { request } = useTrip();
  const {
    messages, busy, chatId, chats, chatsReady, ask, again, stop, clear, open, remove, load,
  } = useAskThread(trip.id);
  const empty = !messages.length;
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [menuEl, setMenuEl] = useState(null);
  const [doomed, setDoomed] = useState(null); // { id, title } waiting on a yes
  const doomedShown = useKept(doomed);
  const input = useRef(null);
  const end = useRef(null);
  const pinned = useRef(true);

  const today = useMemo(() => zonedNow(trip.timezone || undefined).date, [trip.timezone]);
  const suggestions = useMemo(() => askSuggestions(trip, activities, today), [trip, activities, today]);
  const pickGreeting = () => {
    const lines = askGreetings(trip, today);
    return lines[Math.floor(Math.random() * lines.length)];
  };
  const [greeting, setGreeting] = useState(pickGreeting);

  useEffect(() => { load(); }, [load]);

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

  async function openChat(id) {
    setMenuEl(null);
    setError('');
    if (id === chatId) return;
    if (!(await open(id))) setError('That conversation could not be opened. Please try again.');
    else window.scrollTo(0, 0);
  }

  function startNew() {
    clear();
    setGreeting(pickGreeting());
    setError('');
    input.current?.focus();
  }

  async function confirmDelete() {
    const target = doomed;
    setDoomed(null);
    if (target && !(await remove(target.id))) setError('That conversation could not be deleted. Please try again.');
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

  // The box is a different element on the blank page and under a
  // conversation, so the cursor follows it across.
  useEffect(() => { if (input.current) input.current.focus({ preventScroll: true }); }, [empty]);

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

  const current = chats.find((c) => c.id === chatId);

  const chatMenu = (
    <Popover anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)} width={320}>
      <div className={`act-menu ${s.chatMenu}`} role="menu">
        {chats.map((c) => (
          <button key={c.id} type="button" role="menuitem" aria-current={c.id === chatId || undefined}
            onClick={() => openChat(c.id)}>
            <span className={s.chatTitle}>{c.title || 'Untitled chat'}</span>
            <span className="menu-tail">{when(c.updated_at)}</span>
          </button>
        ))}
      </div>
    </Popover>
  );

  const box = (
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
  );

  /*
   * Before the first question the page is the question: one line, the box
   * right under it, a few short starters, and the last few chats. The box
   * moves to the foot of the window once there is a conversation to read
   * above it.
   */
  if (empty) {
    return (
      <div className={`${s.page} ${s.blank}`}>
        <div className={s.corner}>
          {chats.length ? (
            <button type="button" className="btn ghost sm" aria-haspopup="menu" aria-expanded={!!menuEl}
              data-tip="Your chats. Only you can see them."
              onClick={(e) => setMenuEl(menuEl ? null : e.currentTarget)}>
              <History size={15} /> Chats
            </button>
          ) : null}
        </div>
        {chatMenu}
        <div className={s.hero}>
          <div className={`page-head ${s.greet}`}><h2>{greeting}</h2></div>
          {error ? <p className="err" role="alert">{error}</p> : null}
          {box}
          <div className={`cmd-examples ${s.chips}`}>
            {suggestions.map((q) => (
              <button key={q} type="button" className="samplechip" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
          {chatsReady && chats.length ? (
            <div className={s.recent}>
              <div className="small muted">Recent</div>
              <ul className={s.chatList}>
                {chats.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <button type="button" className={s.chatRow} onClick={() => openChat(c.id)}>
                      <span className={s.chatTitle}>{c.title || 'Untitled chat'}</span>
                      <span className="small muted">{when(c.updated_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <div className="page-head spread">
        <h2>Assistant</h2>
        {chats.length || !empty ? (
          <div className="page-head-acts">
            {chats.length ? (
              <button type="button" className="btn ghost sm" aria-haspopup="menu" aria-expanded={!!menuEl}
                onClick={(e) => setMenuEl(menuEl ? null : e.currentTarget)}>
                <History size={15} /> Chats
              </button>
            ) : null}
            {current ? (
              <button type="button" className="btn ghost sm icon-btn" data-tip="Delete this chat" aria-label="Delete this chat"
                disabled={busy} onClick={() => setDoomed(current)}>
                <Trash2 size={15} />
              </button>
            ) : null}
            {!empty ? (
              <button type="button" className="btn ghost sm" onClick={startNew}>
                <SquarePen size={15} /> New chat
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {chatMenu}

      <div className={s.log} aria-live="polite">
        {messages.map((m, i) => (m.role === 'user' ? (
          <div key={m.id} className={`${g.askMe} ${s.me}`}><p>{m.content}</p></div>
        ) : (
          <AskAnswer key={m.id} message={m} last={i === messages.length - 1 && !busy}
            trip={trip} days={days} activities={activities}
            onOpenStop={openStop} onAddPlace={addPlace} onAgain={askAgain} />
        )))}
      </div>
      <div ref={end} className={s.end} />

      <div className={s.dock}>
        {error ? <p className="err" role="alert">{error}</p> : null}
        {box}
        <p className={`small muted ${s.fine}`}>Answers can be wrong. Check times and prices before you rely on them.</p>
      </div>

      {doomedShown.value ? (
        <ConfirmModal title="Delete this chat?" confirmLabel="Delete chat" leaving={doomedShown.leaving}
          onClose={() => setDoomed(null)} onConfirm={confirmDelete}>
          <p>Delete &ldquo;{doomedShown.value.title || 'Untitled chat'}&rdquo;? This cannot be undone.</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
