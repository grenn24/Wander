'use client';
import { useCallback, useSyncExternalStore } from 'react';

/*
 * The conversation on a trip's Ask page, kept outside the page.
 *
 * Leaving the tab unmounts the page, and an answer still being written should
 * not be thrown away because someone glanced at the map meanwhile: the request
 * belongs to this store, which outlives the page, and the page only watches
 * it. The thread is also copied to sessionStorage so a reload keeps it; it is
 * this browser tab's and nobody else's, and closing the tab ends it.
 */

const EMPTY = Object.freeze({ messages: [], busy: false });
const threads = new Map();
const watchers = new Map();
const running = new Map();
const KEY = (tripId) => `wander:ask:${tripId}`;

function read(tripId) {
  if (threads.has(tripId)) return threads.get(tripId);
  let state = EMPTY;
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY(tripId)) || 'null');
    if (saved && Array.isArray(saved.messages)) {
      // An answer that was being written when the page went away is not
      // coming back; say so rather than show it as still on its way.
      const messages = saved.messages.map((m) => (m.role === 'assistant' && m.status === 'writing'
        ? { ...m, status: m.content ? 'stopped' : 'error', error: m.content ? '' : 'This answer did not finish.' }
        : m));
      state = { messages, busy: false };
    }
  } catch { /* storage blocked or corrupt: start empty */ }
  threads.set(tripId, state);
  return state;
}

function save(tripId) {
  try {
    const { messages } = read(tripId);
    if (messages.length) sessionStorage.setItem(KEY(tripId), JSON.stringify({ messages: messages.slice(-40) }));
    else sessionStorage.removeItem(KEY(tripId));
  } catch { /* full or blocked: the thread still lives in memory */ }
}

function set(tripId, next, persist = false) {
  threads.set(tripId, next);
  (watchers.get(tripId) || new Set()).forEach((fn) => fn());
  if (persist) save(tripId);
}

function patchLast(tripId, fn, persist) {
  const s = read(tripId);
  const last = s.messages[s.messages.length - 1];
  if (!last || last.role !== 'assistant') return;
  set(tripId, { ...s, messages: [...s.messages.slice(0, -1), fn(last)] }, persist);
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/**
 * Ask, and stream the answer into the thread.
 *
 * `token` is the asker's Supabase access token; the route reads the trip
 * with it. `again` re-asks the last question in place of its answer.
 */
async function run(tripId, question, token, { again = false } = {}) {
  let s = read(tripId);
  if (s.busy) return;
  let messages = s.messages;
  if (again) {
    // Drop the last answer and ask its question again.
    while (messages.length && messages[messages.length - 1].role === 'assistant') messages = messages.slice(0, -1);
  } else {
    messages = [...messages, { id: uid(), role: 'user', content: question }];
  }
  const asked = messages[messages.length - 1];
  if (!asked || asked.role !== 'user') return;
  const history = messages.slice(0, -1).filter((m) => m.content && m.status !== 'error')
    .map(({ role, content }) => ({ role, content }));
  set(tripId, {
    busy: true,
    messages: [...messages, { id: uid(), role: 'assistant', content: '', sources: [], status: 'writing', searching: false }],
  }, true);

  const ctrl = new AbortController();
  running.set(tripId, ctrl);
  let got = '';
  try {
    const res = await fetch('/api/trips/ask', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tripId, question: asked.content, history }),
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
    const take = (line) => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'text') got += ev.delta;
      else if (ev.type === 'status') patchLast(tripId, (m) => ({ ...m, searching: ev.status === 'searching', searched: ev.query || m.searched }));
      else if (ev.type === 'source') patchLast(tripId, (m) => ({ ...m, sources: [...(m.sources || []), { url: ev.url, title: ev.title }] }));
      else if (ev.type === 'error') failed = ev.message || 'Something went wrong. Please try again.';
      else if (ev.type === 'done') cut = !!ev.cut;
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
    if (failed && !got.trim()) throw new Error(failed);
    if (!got.trim()) throw new Error('No answer came back. Please try again.');
    patchLast(tripId, (m) => ({ ...m, content: got, searching: false, status: failed || cut ? 'stopped' : 'done', error: failed }), true);
  } catch (e) {
    const stopped = e && e.name === 'AbortError';
    patchLast(tripId, (m) => ({
      ...m,
      content: got,
      searching: false,
      status: stopped && got ? 'stopped' : stopped ? 'cancelled' : 'error',
      error: stopped ? '' : (e && e.message) || 'Something went wrong. Please try again.',
    }), true);
    // Stopped before a word arrived: nothing worth keeping on screen.
    if (stopped && !got) {
      const st = read(tripId);
      set(tripId, { ...st, messages: st.messages.slice(0, -1) }, true);
    }
  } finally {
    running.delete(tripId);
    set(tripId, { ...read(tripId), busy: false }, true);
  }
}

function stop(tripId) {
  const ctrl = running.get(tripId);
  if (ctrl) ctrl.abort();
}

function clear(tripId) {
  stop(tripId);
  set(tripId, EMPTY, true);
}

/** The thread for one trip, and what can be done to it. */
export function useAskThread(tripId) {
  const subscribe = useCallback((fn) => {
    if (!watchers.has(tripId)) watchers.set(tripId, new Set());
    watchers.get(tripId).add(fn);
    return () => watchers.get(tripId).delete(fn);
  }, [tripId]);
  const state = useSyncExternalStore(subscribe, () => read(tripId), () => EMPTY);
  return {
    ...state,
    ask: useCallback((q, token) => run(tripId, q, token), [tripId]),
    again: useCallback((token) => run(tripId, '', token, { again: true }), [tripId]),
    stop: useCallback(() => stop(tripId), [tripId]),
    clear: useCallback(() => clear(tripId), [tripId]),
  };
}
