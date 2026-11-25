'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { getClient } from '@/lib/supabase';
import { attachmentNote, changeNote, settledSteps, withStep } from '@/lib/tripAsk';

/*
 * The trip Assistant's conversations, kept outside the page.
 *
 * Leaving the tab unmounts the page, and an answer still being written should
 * not be thrown away because someone glanced at the map meanwhile: the request
 * belongs to this store, which outlives the page, and the page only watches it.
 *
 * Every finished answer is saved to `trip_chats`, one row per conversation,
 * readable only by the person who had it (row level security does the
 * checking). The open conversation is also mirrored to sessionStorage, so a
 * reload lands back in it before the database has answered — and a
 * conversation that was never saved (one from before saving existed, or from
 * a database without the table yet) is saved as soon as it can be.
 *
 * An answer can also carry a change to the trip: the edits the Assistant
 * proposed (`proposal`, with its `state` — pending, applied or discarded), a
 * question the editor needs answered first (`editQuestion`), or why the edits
 * could not be worked out (`proposalError`). They are kept with the chat, so
 * reopening it shows what was proposed and what became of it.
 */

const EMPTY_LIST = Object.freeze([]);
const fresh = () => ({ key: uid(), messages: EMPTY_LIST, busy: false });
const threads = new Map(); // tripId -> { key, messages, busy }
const lists = new Map(); // tripId -> { chats, ready, canSave }
const watchers = new Map();
const running = new Map(); // tripId -> { ctrl, done: Promise }
const ids = new Map(); // thread key -> saved chat id
const chains = new Map(); // tripId -> Promise (saves, one at a time)
const KEY = (tripId) => `wander:ask:${tripId}`;
const NO_LIST = Object.freeze({ chats: EMPTY_LIST, ready: false, canSave: true });

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
const SERVER_EMPTY = fresh();

/*
 * Whose conversations these are. They live in memory and in the tab's
 * storage, both of which outlast a sign-out; the next person to sign in on
 * this browser must not find the last one's chat open on a trip they share.
 */
let watching = false;
function watchAuth() {
  if (watching || typeof window === 'undefined') return;
  const client = getClient();
  if (!client) return;
  watching = true;
  client.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT') return;
    running.forEach((r) => r.ctrl.abort());
    const trips = [...watchers.keys()];
    threads.clear();
    lists.clear();
    ids.clear();
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith('wander:ask')).forEach((k) => sessionStorage.removeItem(k));
    } catch { /* blocked */ }
    trips.forEach(notify);
  });
}

function notify(tripId) {
  (watchers.get(tripId) || new Set()).forEach((fn) => fn());
}

function read(tripId) {
  if (threads.has(tripId)) return threads.get(tripId);
  let state = fresh();
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY(tripId)) || 'null');
    if (saved && Array.isArray(saved.messages) && saved.messages.length) {
      // An answer that was being written when the page went away is not
      // coming back; say so rather than show it as still on its way.
      const messages = saved.messages.map((m) => (m.role === 'assistant' && m.status === 'writing'
        ? { ...m, status: m.content ? 'stopped' : 'error', error: m.content ? '' : 'This answer did not finish.' }
        : m));
      state = { key: saved.key || uid(), messages, busy: false, title: saved.title || '' };
      if (saved.chatId) ids.set(state.key, saved.chatId);
    }
  } catch { /* storage blocked or corrupt: start empty */ }
  threads.set(tripId, state);
  return state;
}

function mirror(tripId) {
  try {
    const { key, messages, title } = read(tripId);
    if (messages.length) {
      // Without the attached files themselves: a few photos would fill the tab's storage.
      sessionStorage.setItem(KEY(tripId), JSON.stringify({ key, title: title || '', chatId: ids.get(key) || null, messages: keepable(messages).slice(-40) }));
    } else sessionStorage.removeItem(KEY(tripId));
  } catch { /* full or blocked: the thread still lives in memory */ }
}

function set(tripId, next, persist = false) {
  threads.set(tripId, next);
  notify(tripId);
  if (persist) mirror(tripId);
}

function setList(tripId, patch) {
  lists.set(tripId, { ...(lists.get(tripId) || NO_LIST), ...patch });
  notify(tripId);
}

function patchLast(tripId, fn, persist) {
  const s = read(tripId);
  const last = s.messages[s.messages.length - 1];
  if (!last || last.role !== 'assistant') return;
  set(tripId, { ...s, messages: [...s.messages.slice(0, -1), fn(last)] }, persist);
}

/* ------------------------------------------------------------- database --- */

// A database that has not been given the table yet (production before its
// SQL has been run) is not an error to show anyone: conversations just are
// not kept there, the way they were not before.
const missingTable = (error) => !!error && (error.code === '42P01' || error.code === 'PGRST205'
  || /trip_chats/.test(String(error.message || '')));

const titleOf = (messages) => {
  const first = messages.find((m) => m.role === 'user');
  const said = String((first && first.content) || '').replace(/\s+/g, ' ').trim();
  // A photo sent on its own is titled by what was sent.
  const sent = ((first && first.attachments) || [])[0];
  const t = said || (sent ? (sent.kind === 'image' ? 'A photo' : sent.name) : '');
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
};

// What is worth keeping of a turn: not whether a search (or a proposal) was
// under way, and not the attached files themselves — their names and
// thumbnails stay, the photographs and PDFs do not (a database row is no
// place for megabytes). What the search did is kept, so a chat reopened later
// still shows it.
const changed = (m) => !!(m.proposal || m.editQuestion || m.proposalError);
const keepable = (messages) => messages
  .filter((m) => m.role === 'user' || m.content || m.error || changed(m))
  .map(({
    searching, proposing, files, ...m
  }) => (Array.isArray(m.steps) ? { ...m, steps: settledSteps(m.steps) } : m));

export async function loadChats(tripId) {
  const client = getClient();
  if (!client) return;
  const { data, error } = await client.from('trip_chats')
    .select('id, title, updated_at').eq('trip_id', tripId)
    .order('updated_at', { ascending: false }).limit(50);
  if (error) {
    if (!missingTable(error)) console.warn('[assistant] could not list chats:', error.message);
    setList(tripId, { ready: true, canSave: !missingTable(error) && (lists.get(tripId) || NO_LIST).canSave });
    return;
  }
  setList(tripId, { chats: data || [], ready: true, canSave: true });
  // A conversation from before it could be saved is saved now.
  const s = read(tripId);
  if (s.messages.length && !ids.get(s.key) && !s.busy) save(tripId);
}

/**
 * Save the open conversation as it is now. Saves run one at a time per trip,
 * so a second answer finishing before the first save has come back updates
 * the row the first one made rather than making another.
 */
function save(tripId) {
  const { key, messages, title: named } = read(tripId);
  const snapshot = keepable(messages);
  if (!snapshot.length) return Promise.resolve();
  // The chat's own name when it has one, its first question until then.
  const title = named || titleOf(snapshot);
  const run = async () => {
    const list = lists.get(tripId) || NO_LIST;
    const client = getClient();
    if (!client || !list.canSave) return;
    const now = new Date().toISOString();
    const id = ids.get(key);
    if (id) {
      const { error } = await client.from('trip_chats').update({ messages: snapshot, title, updated_at: now }).eq('id', id);
      if (error) { console.warn('[assistant] could not save the chat:', error.message); return; }
      const rest = (lists.get(tripId) || NO_LIST).chats.filter((c) => c.id !== id);
      setList(tripId, { chats: [{ id, title, updated_at: now }, ...rest] });
      return;
    }
    const { data, error } = await client.from('trip_chats')
      .insert({ trip_id: tripId, title, messages: snapshot })
      .select('id, title, updated_at').single();
    if (error) {
      if (missingTable(error)) setList(tripId, { canSave: false });
      else console.warn('[assistant] could not save the chat:', error.message);
      return;
    }
    ids.set(key, data.id);
    if (read(tripId).key === key) mirror(tripId);
    setList(tripId, { chats: [data, ...(lists.get(tripId) || NO_LIST).chats.filter((c) => c.id !== data.id)] });
  };
  const next = (chains.get(tripId) || Promise.resolve()).then(run, run);
  chains.set(tripId, next);
  notify(tripId);
  return next;
}

/* --------------------------------------------------------------- asking --- */

/**
 * Ask, and stream the answer into the thread.
 *
 * `token` is the asker's Supabase access token; the route reads the trip
 * with it. `again` re-asks the last question in place of its answer.
 */
async function run(tripId, question, token, { again = false, attachments = [] } = {}) {
  const s = read(tripId);
  if (s.busy) return;
  let messages = s.messages;
  if (again) {
    // Drop the last answer and ask its question again.
    while (messages.length && messages[messages.length - 1].role === 'assistant') messages = messages.slice(0, -1);
  } else {
    messages = [...messages, {
      id: uid(),
      role: 'user',
      content: question,
      at: new Date().toISOString(),
      // What is shown and kept: kind, name and a small thumbnail.
      attachments: attachments.map(({ kind, name, thumb }) => ({ kind, name, ...(thumb ? { thumb } : {}) })),
      // What is sent: the files themselves, for this request (and Ask again) only.
      files: attachments.map(({ thumb, ...a }) => a),
    }];
  }
  const asked = messages[messages.length - 1];
  if (!asked || asked.role !== 'user') return;
  // Earlier attachments are named, not sent again; earlier changes say what
  // became of them.
  const history = messages.slice(0, -1)
    .filter((m) => (m.content || (m.attachments || []).length || changed(m)) && m.status !== 'error')
    .map((m) => ({
      role: m.role,
      content: [m.content, attachmentNote(m.attachments), changeNote(m)].filter(Boolean).join('\n'),
    }));
  set(tripId, {
    ...s,
    busy: true,
    messages: [...messages, { id: uid(), role: 'assistant', content: '', sources: [], steps: [], status: 'writing', searching: false }],
  }, true);

  const ctrl = new AbortController();
  let finish;
  running.set(tripId, { ctrl, done: new Promise((r) => { finish = r; }) });
  let got = '';
  try {
    const res = await fetch('/api/trips/ask', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // A chat without a name yet is named from its first question.
      body: JSON.stringify({
        tripId, question: asked.content, history, attachments: asked.files || [], wantTitle: !history.length && !s.title,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || (res.status === 401 ? 'Your session ended. Sign in again to ask.' : 'Something went wrong. Please try again.'));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let failed = '';
    let cut = false;
    let proposed = false; // a change came back, so an answer with no words is still an answer
    const take = (line) => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'text') got += ev.delta;
      else if (ev.type === 'status') {
        patchLast(tripId, (m) => ({
          ...m,
          searching: ev.status === 'searching',
          searched: ev.query || m.searched,
          steps: withStep(m.steps, ev),
          proposing: ev.status === 'proposing' || m.proposing,
        }));
      } else if (ev.type === 'proposal') {
        proposed = true;
        const ops = Array.isArray(ev.ops) ? ev.ops : [];
        patchLast(tripId, (m) => ({
          ...m, proposing: false, proposal: { summary: String(ev.summary || ''), ops, state: 'pending' },
        }));
      } else if (ev.type === 'question' && ev.question) {
        proposed = true;
        patchLast(tripId, (m) => ({ ...m, proposing: false, editQuestion: ev.question }));
      } else if (ev.type === 'proposal_error') {
        proposed = true;
        patchLast(tripId, (m) => ({ ...m, proposing: false, proposalError: ev.message || 'The changes could not be worked out.' }));
      }
      else if (ev.type === 'source') patchLast(tripId, (m) => ({ ...m, sources: [...(m.sources || []), { url: ev.url, title: ev.title }] }));
      else if (ev.type === 'error') failed = ev.message || 'Something went wrong. Please try again.';
      else if (ev.type === 'done') cut = !!ev.cut;
      else if (ev.type === 'title' && ev.title) {
        const now = read(tripId);
        // Unless they have named it themselves in the meantime.
        if (!now.title) set(tripId, { ...now, title: String(ev.title).slice(0, 80) }, true);
      }
    };
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      lines.forEach(take);
      const now = got;
      // Words arriving mean the search is over, whatever the stream said last.
      patchLast(tripId, (m) => ({ ...m, content: now, searching: now ? false : m.searching }));
    }
    take(buf);
    if (failed && !got.trim() && !proposed) throw new Error(failed);
    if (!got.trim() && !proposed) throw new Error('No answer came back. Please try again.');
    patchLast(tripId, (m) => ({
      ...m,
      content: got,
      searching: false,
      proposing: false,
      steps: settledSteps(m.steps),
      status: failed || cut ? 'stopped' : 'done',
      error: failed,
      at: new Date().toISOString(),
    }), true);
  } catch (e) {
    const stopped = e && e.name === 'AbortError';
    patchLast(tripId, (m) => ({
      ...m,
      content: got,
      searching: false,
      proposing: false,
      steps: settledSteps(m.steps),
      status: stopped && got ? 'stopped' : stopped ? 'cancelled' : 'error',
      error: stopped ? '' : (e && e.message) || 'Something went wrong. Please try again.',
    }), true);
    // Stopped before a word arrived: nothing worth keeping on screen.
    if (stopped && !got) {
      const st = read(tripId);
      set(tripId, { ...st, messages: st.messages.slice(0, -1) }, true);
    }
  } finally {
    set(tripId, { ...read(tripId), busy: false }, true);
    running.delete(tripId);
    finish();
    save(tripId);
  }
}

function stop(tripId) {
  const r = running.get(tripId);
  if (r) r.ctrl.abort();
}

/** Stop whatever is being written, and let its save land, before switching. */
async function settle(tripId) {
  const r = running.get(tripId);
  if (r) { r.ctrl.abort(); await r.done; }
  await (chains.get(tripId) || Promise.resolve());
}

async function newChat(tripId) {
  await settle(tripId);
  set(tripId, fresh(), true);
}

/** Reopen a saved conversation. Resolves false when it could not be read. */
async function openChat(tripId, chatId) {
  await settle(tripId);
  const client = getClient();
  if (!client) return false;
  const { data, error } = await client.from('trip_chats').select('id, title, messages').eq('id', chatId).maybeSingle();
  if (error || !data) return false;
  const key = uid();
  ids.set(key, data.id);
  set(tripId, { key, messages: Array.isArray(data.messages) ? data.messages : [], busy: false, title: data.title || '' }, true);
  return true;
}

/**
 * Name the open conversation. Saved at once when it is already saved;
 * otherwise it goes with the first save.
 */
async function renameChat(tripId, title) {
  const name = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const s = read(tripId);
  if (!name || name === s.title) return true;
  set(tripId, { ...s, title: name }, true);
  const id = ids.get(s.key);
  const client = getClient();
  if (!id || !client) return true;
  const { error } = await client.from('trip_chats').update({ title: name }).eq('id', id);
  if (error) { console.warn('[assistant] could not rename the chat:', error.message); return false; }
  setList(tripId, { chats: (lists.get(tripId) || NO_LIST).chats.map((c) => (c.id === id ? { ...c, title: name } : c)) });
  return true;
}

/**
 * What became of a proposed change: applied (with how many edits) or
 * discarded. Kept with the chat, so the card never offers to apply twice.
 */
function markProposal(tripId, messageId, patch) {
  const s = read(tripId);
  let hit = false;
  const messages = s.messages.map((m) => {
    if (m.id !== messageId || !m.proposal) return m;
    hit = true;
    return { ...m, proposal: { ...m.proposal, ...patch } };
  });
  if (!hit) return;
  set(tripId, { ...s, messages }, true);
  // An answer still being written is saved, with this, when it finishes.
  if (!s.busy) save(tripId);
}

/** Delete a conversation for good. Resolves false when it could not be. */
async function removeChat(tripId, chatId) {
  const client = getClient();
  if (!client) return false;
  if (ids.get(read(tripId).key) === chatId) await settle(tripId);
  const { error } = await client.from('trip_chats').delete().eq('id', chatId);
  if (error) { console.warn('[assistant] could not delete the chat:', error.message); return false; }
  setList(tripId, { chats: (lists.get(tripId) || NO_LIST).chats.filter((c) => c.id !== chatId) });
  if (ids.get(read(tripId).key) === chatId) set(tripId, fresh(), true);
  return true;
}

/** The open conversation for one trip, the saved ones, and what can be done with them. */
export function useAskThread(tripId) {
  const subscribe = useCallback((fn) => {
    watchAuth();
    if (!watchers.has(tripId)) watchers.set(tripId, new Set());
    watchers.get(tripId).add(fn);
    return () => watchers.get(tripId).delete(fn);
  }, [tripId]);
  const state = useSyncExternalStore(subscribe, () => read(tripId), () => SERVER_EMPTY);
  const list = useSyncExternalStore(subscribe, () => lists.get(tripId) || NO_LIST, () => NO_LIST);
  return {
    messages: state.messages,
    busy: state.busy,
    title: state.title || '',
    chatId: ids.get(state.key) || null,
    chats: list.chats,
    chatsReady: list.ready,
    canSave: list.canSave,
    load: useCallback(() => loadChats(tripId), [tripId]),
    ask: useCallback((q, token, attachments) => run(tripId, q, token, { attachments: attachments || [] }), [tripId]),
    again: useCallback((token) => run(tripId, '', token, { again: true }), [tripId]),
    stop: useCallback(() => stop(tripId), [tripId]),
    clear: useCallback(() => newChat(tripId), [tripId]),
    open: useCallback((id) => openChat(tripId, id), [tripId]),
    remove: useCallback((id) => removeChat(tripId, id), [tripId]),
    rename: useCallback((title) => renameChat(tripId, title), [tripId]),
    mark: useCallback((id, patch) => markProposal(tripId, id, patch), [tripId]),
  };
}
