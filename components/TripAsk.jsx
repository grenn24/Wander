'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUp, FileText, History, Loader2, Mic, Paperclip, Sparkles, Square, SquarePen, Trash2, X,
} from 'lucide-react';
import ShotStrip from '@/components/ShotStrip';
import Lightbox from '@/components/Lightbox';
import { ACCEPT, attach, canRecord, useRecorder } from '@/components/askAttach';
import { useApp } from '@/components/AppProvider';
import { useTrip } from '@/components/TripProvider';
import GrowArea from '@/components/GrowArea';
import Popover from '@/components/Popover';
import ConfirmModal from '@/components/ConfirmModal';
import useKept from '@/components/useKept';
import useKeyboardInset from '@/components/useKeyboardInset';
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
 * trip's own stops, and maps. Asked to change the plan, it proposes the edits
 * itself — the command bar's editor writes them — and they sit under its
 * answer to apply or discard; nothing is saved before Apply. Conversations are
 * kept for the person who had them, and nobody else on the trip sees them.
 */
export default function TripAsk({ trip, days, activities }) {
  const router = useRouter();
  const { supabase } = useApp();
  const { request } = useTrip();
  const {
    messages, busy, title, chatId, chats, chatsReady, ask, again, stop, clear, open, remove, load, rename, mark,
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
  // The on-screen keyboard's height while it is up: the box rides above it.
  const keyboard = useKeyboardInset();
  // What goes with the next question: photos, PDFs, text files.
  const [files, setFiles] = useState([]);
  const [over, setOver] = useState(false); // something is being dragged onto the box
  const [viewing, setViewing] = useState(null); // { photos, index } from a sent message
  const [naming, setNaming] = useState(null); // the title being typed, while renaming
  const picker = useRef(null);
  // The microphone shows only where the browser can record.
  const [mic, setMic] = useState(false);
  useEffect(() => { setMic(canRecord()); }, []);

  const today = useMemo(() => zonedNow(trip.timezone || undefined).date, [trip.timezone]);
  const suggestions = useMemo(() => askSuggestions(trip, activities, today), [trip, activities, today]);
  const pickGreeting = () => {
    const lines = askGreetings(trip, today);
    return lines[Math.floor(Math.random() * lines.length)];
  };
  const [greeting, setGreeting] = useState(pickGreeting);

  useEffect(() => { load(); }, [load]);

  // No window scrollbar while the Assistant is open (globals.css); the other
  // tabs keep theirs.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.scrollbar = 'none';
    return () => { delete root.dataset.scrollbar; };
  }, []);

  async function token() {
    const { data } = supabase ? await supabase.auth.getSession() : { data: null };
    return data && data.session && data.session.access_token;
  }

  async function send(said) {
    const q = String(said || '').trim();
    if ((!q && !files.length) || busy || voice.state !== 'idle') return;
    const t = await token();
    if (!t) { setError('Sign in again to ask about this trip.'); return; }
    setError('');
    setText('');
    const sending = files;
    setFiles([]);
    pinned.current = true;
    ask(q, t, sending);
  }

  // A tapped answer to a question the editor asked, sent as the next message.
  const sendRef = useRef(send);
  sendRef.current = send;
  const reply = useCallback((said) => sendRef.current(said), []);

  async function take(list) {
    if (!list || !list.length) return;
    setError('');
    const { list: next, why } = await attach(list, files);
    setFiles(next);
    if (why) setError(why);
    input.current?.focus();
  }

  /*
   * Talking instead of typing: what was said lands in the box, to be read
   * and sent like anything typed, rather than going straight to the model.
   */
  const hint = useMemo(() => [trip.destination, ...activities.slice(0, 20).map((a) => a.title)]
    .filter(Boolean).join(', '), [trip.destination, activities]);
  const voice = useRecorder({
    token,
    hint,
    onText: (said) => {
      setError('');
      setText((was) => (was.trim() ? `${was.trimEnd()} ${said}` : said));
      input.current?.focus();
    },
    onError: setError,
  });

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
  }, [messages.length, last && last.content, last && last.searching, last && last.steps]);

  // The keyboard coming up takes the bottom of the window, so a reader who
  // was at the end is kept at the end, above it.
  useEffect(() => {
    if (keyboard && pinned.current && end.current) end.current.scrollIntoView({ block: 'end' });
  }, [keyboard]);

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

  const photos = files.filter((a) => a.kind === 'image');
  const docs = files.filter((a) => a.kind !== 'image');
  const listening = voice.state === 'listening';
  const box = (
    <div className={s.composer}>
      <form className={`planbox-field${over ? ' is-over' : ''}`}
        onSubmit={(e) => { e.preventDefault(); send(text); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer && e.dataTransfer.files); }}>
        <span className="planbox-spark" aria-hidden="true"><Sparkles size={17} /></span>
        {listening ? (
          <div className={`planbox-input ${s.input} ${s.listening}`} role="status">
            <span className={s.recDot} aria-hidden="true" />
            Listening {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, '0')}
            <button type="button" className={`btn ghost sm ${s.recCancel}`} onClick={voice.cancel}>Cancel</button>
          </div>
        ) : (
          <GrowArea ref={input} className={`planbox-input ${s.input}`} value={text} maxLength={2000}
            aria-label="Your question" placeholder={empty ? 'Ask about this trip' : 'Ask a follow-up'}
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)} onSubmit={() => send(text)}
            onPaste={(e) => {
              const pasted = e.clipboardData && e.clipboardData.files;
              if (pasted && pasted.length) { e.preventDefault(); take(pasted); }
            }} />
        )}
        <input ref={picker} type="file" accept={ACCEPT} multiple hidden
          onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
        <button className="btn ghost planbox-clip" type="button" disabled={listening}
          data-tip="Add photos or files" aria-label="Add photos or files"
          onClick={() => picker.current && picker.current.click()}>
          <Paperclip size={17} />
        </button>
        {mic ? (
          voice.state === 'working' ? (
            <button className="btn ghost planbox-clip" type="button" disabled aria-label="Working out what was said">
              <Loader2 size={17} className="spin" />
            </button>
          ) : (
            <button className={`btn ghost planbox-clip${listening ? ` ${s.recOn}` : ''}`} type="button"
              disabled={busy}
              data-tip={listening ? 'Done talking' : 'Talk instead of typing'}
              aria-label={listening ? 'Done talking' : 'Talk instead of typing'}
              onClick={listening ? voice.stop : voice.start}>
              {listening ? <Square size={14} /> : <Mic size={17} />}
            </button>
          )
        ) : null}
        {busy ? (
          <button type="button" className="btn planbox-go" aria-label="Stop" data-tip="Stop" onClick={stop}>
            <Square size={14} />
          </button>
        ) : (
          <button type="submit" className="btn primary planbox-go" aria-label="Ask"
            disabled={(!text.trim() && !files.length) || voice.state !== 'idle'}>
            <ArrowUp size={18} />
          </button>
        )}
      </form>
      {files.length ? (
        <div className={s.attached}>
          <ShotStrip shots={photos} onRemove={(i) => setFiles((was) => was.filter((a) => a !== photos[i]))} />
          {docs.map((a) => (
            <span key={`${a.name}-${files.indexOf(a)}`} className={s.fileChip}>
              <FileText size={14} aria-hidden="true" />
              <span className={s.fileName}>{a.name}</span>
              <button type="button" aria-label={`Remove ${a.name}`} data-tip="Remove"
                onClick={() => setFiles((was) => was.filter((x) => x !== a))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );

  // What a sent question carried, under its words: thumbnails and file names.
  const sentWith = (m) => {
    const had = m.attachments || [];
    if (!had.length) return null;
    const shots = had.filter((a) => a.kind === 'image' && a.thumb).map((a) => ({ url: a.thumb, name: a.name }));
    return (
      <div className={s.sent}>
        {shots.map((p, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <button key={i} type="button" className={s.sentShot} aria-label={`Attached photo ${i + 1}`}
            onClick={() => setViewing({ photos: shots, index: i })}>
            <img src={p.url} alt="" />
          </button>
        ))}
        {had.filter((a) => a.kind !== 'image').map((a, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <span key={i} className={s.fileChip}><FileText size={14} aria-hidden="true" /><span className={s.fileName}>{a.name}</span></span>
        ))}
      </div>
    );
  };

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

  // `ask-page` is global on purpose: globals.css takes the trip page's bottom
  // padding away for it, so the prompt box has one place to sit.
  return (
    <div className={`${s.page} ask-page`} data-keyboard={keyboard ? '' : undefined}
      style={keyboard ? { '--kb': `${keyboard}px` } : undefined}>
      <div className={`page-head spread ${s.head}`}>
        {/* The chat's name, written for it from its first question; clicking
            it renames it. "Assistant" only until it has one. Pinned under the
            top bar, with Chats and New chat, however far down the reader is. */}
        <h2 className={s.titled}>
          {naming !== null ? (
            <input className={s.titleInput} value={naming} maxLength={80} autoFocus
              aria-label="Chat name"
              onChange={(e) => setNaming(e.target.value)}
              onBlur={() => { if (naming.trim()) rename(naming); setNaming(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                if (e.key === 'Escape') { e.preventDefault(); setNaming(null); }
              }} />
          ) : (
            <button type="button" className={s.titleButton} data-tip="Rename this chat"
              onClick={() => setNaming(title || '')}>
              {title || 'Assistant'}
            </button>
          )}
        </h2>
        {chats.length || !empty ? (
          <div className="page-head-acts">
            {chats.length ? (
              <button type="button" className="btn ghost sm" aria-haspopup="menu" aria-expanded={!!menuEl}
                aria-label="Chats" data-tip="Your chats. Only you can see them."
                onClick={(e) => setMenuEl(menuEl ? null : e.currentTarget)}>
                <History size={15} /> <span className={s.btnWord}>Chats</span>
              </button>
            ) : null}
            {current ? (
              <button type="button" className="btn ghost sm icon-btn" data-tip="Delete this chat" aria-label="Delete this chat"
                disabled={busy} onClick={() => setDoomed(current)}>
                <Trash2 size={15} />
              </button>
            ) : null}
            {!empty ? (
              <button type="button" className="btn ghost sm" aria-label="New chat" data-tip="New chat" onClick={startNew}>
                <SquarePen size={15} /> <span className={s.btnWord}>New chat</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {chatMenu}

      <div className={s.log} aria-live="polite">
        {messages.map((m, i) => (m.role === 'user' ? (
          <div key={m.id} className={`${g.askMe} ${s.me}`}>
            {sentWith(m)}
            {m.content ? <p>{m.content}</p> : null}
          </div>
        ) : (
          <AskAnswer key={m.id} message={m} last={i === messages.length - 1 && !busy}
            trip={trip} days={days} activities={activities}
            onOpenStop={openStop} onAddPlace={addPlace} onAgain={askAgain} onMark={mark} onReply={reply} />
        )))}
      </div>
      <div ref={end} className={s.end} />

      <div className={s.dock}>
        {error ? <p className="err" role="alert">{error}</p> : null}
        {box}
        <p className={`small muted ${s.fine}`}>Answers can be wrong. Check times and prices before you rely on them.</p>
      </div>

      {viewing ? (
        <Lightbox photos={viewing.photos} index={viewing.index} alt="Attached photo"
          onIndex={(i) => setViewing((v) => (v ? { ...v, index: i } : v))}
          onClose={() => setViewing(null)} />
      ) : null}

      {doomedShown.value ? (
        <ConfirmModal title="Delete this chat?" confirmLabel="Delete chat" leaving={doomedShown.leaving}
          onClose={() => setDoomed(null)} onConfirm={confirmDelete}>
          <p>Delete &ldquo;{doomedShown.value.title || 'Untitled chat'}&rdquo;? This cannot be undone.</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
