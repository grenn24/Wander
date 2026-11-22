'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BadImage, shrink } from '@/lib/image';
import {
  MAX_ATTACHED_CHARS, MAX_FILES, MAX_PDF_BYTES, MAX_PHOTOS, MAX_TEXT_CHARS,
} from '@/lib/tripAsk';

/*
 * What the Assistant's box takes besides words: photos (shrunk here, before
 * they are sent, the way the planner does it), PDFs and plain text files —
 * and the person's voice.
 */

export const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,text/calendar,.txt,.md,.csv,.ics,.json';

const IMAGE = /^image\/(jpeg|png|webp|gif)$/;
const TEXTISH = /^text\/|^application\/json$/;
const TEXT_EXT = /\.(txt|md|csv|ics|json)$/i;

const readAs = (file, how) => new Promise((done, fail) => {
  const fr = new FileReader();
  fr.onload = () => done(String(fr.result || ''));
  fr.onerror = () => fail(new Error('That file could not be read.'));
  if (how === 'url') fr.readAsDataURL(file); else fr.readAsText(file);
});

/** A small copy of a photo, kept with the conversation where the photo is not. */
function thumbOf(url) {
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      const edge = 240;
      const scale = Math.min(1, edge / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      done(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => done('');
    img.src = url;
  });
}

const sizeOf = (a) => (a.url || a.data || a.text || '').length;

/**
 * Files from a picker, a paste or a drop, added to what is already attached.
 * Returns the new list and, when something was left out, why — one reason,
 * in words a person can act on.
 */
export async function attach(files, current) {
  const list = [...current];
  let why = '';
  for (const file of Array.from(files || [])) {
    const type = String(file.type || '').toLowerCase();
    const photos = list.filter((a) => a.kind === 'image').length;
    const docs = list.length - photos;
    try {
      if (IMAGE.test(type)) {
        if (photos >= MAX_PHOTOS) { why = `${MAX_PHOTOS} photos is the most one question can carry.`; continue; }
        // eslint-disable-next-line no-await-in-loop
        const url = await shrink(file);
        // eslint-disable-next-line no-await-in-loop
        list.push({ kind: 'image', name: file.name || 'photo', url, thumb: await thumbOf(url) });
      } else if (type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
        if (docs >= MAX_FILES) { why = `${MAX_FILES} files is the most one question can carry.`; continue; }
        if (file.size > MAX_PDF_BYTES) { why = 'That PDF is too big. Try one under 2.5 MB, or a screenshot of the page that matters.'; continue; }
        // eslint-disable-next-line no-await-in-loop
        const data = (await readAs(file, 'url')).replace(/^data:[^;,]*/, 'data:application/pdf');
        list.push({ kind: 'pdf', name: file.name || 'document.pdf', data });
      } else if (TEXTISH.test(type) || TEXT_EXT.test(file.name || '')) {
        if (docs >= MAX_FILES) { why = `${MAX_FILES} files is the most one question can carry.`; continue; }
        // eslint-disable-next-line no-await-in-loop
        const text = (await readAs(file, 'text')).slice(0, MAX_TEXT_CHARS);
        if (!text.trim()) { why = 'That file is empty.'; continue; }
        list.push({ kind: 'text', name: file.name || 'notes.txt', text });
      } else {
        why = 'Photos, PDFs and text files work here. Word documents do not yet: save it as a PDF.';
        continue;
      }
    } catch (e) {
      why = e instanceof BadImage ? e.message : 'That file could not be read.';
      continue;
    }
    // Everything together has to fit in one request, with the conversation.
    if (list.reduce((n, a) => n + sizeOf(a), 0) > MAX_ATTACHED_CHARS) {
      list.pop();
      why = 'That is more than one question can carry. Send it with fewer files.';
    }
  }
  return { list, why };
}

/* ----------------------------------------------------------------- voice -- */

const LONGEST = 120; // seconds
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export const canRecord = () => typeof window !== 'undefined'
  && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof MediaRecorder !== 'undefined';

/**
 * The microphone, as three states: idle, listening (with seconds so far) and
 * working out what was said. `onText` gets the words; nothing is sent.
 *
 * The stream's tracks are stopped every way out — done, cancelled, gone from
 * the page — or the browser's recording light stays on.
 */
export function useRecorder({ token, hint, onText, onError }) {
  const [state, setState] = useState('idle'); // idle | listening | working
  const [seconds, setSeconds] = useState(0);
  const rec = useRef(null);
  const stream = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(0);
  const keep = useRef(true);
  const latest = useRef({ token, hint, onText, onError });
  latest.current = { token, hint, onText, onError };

  const release = useCallback(() => {
    clearInterval(timer.current);
    if (stream.current) stream.current.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => () => {
    keep.current = false;
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    release();
  }, [release]);

  async function send(blob, type) {
    setState('working');
    try {
      const t = await latest.current.token();
      if (!t) throw new Error('Sign in again to talk to the Assistant.');
      const form = new FormData();
      const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', new File([blob], `speech.${ext}`, { type: type.split(';')[0] }));
      if (latest.current.hint) form.append('hint', latest.current.hint);
      const res = await fetch('/api/transcribe', { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'That could not be heard. Please try again.');
      if (body.text) latest.current.onText(body.text);
      else latest.current.onError('Nothing was heard. Try again a little closer to the microphone.');
    } catch (e) {
      latest.current.onError(e.message || 'That could not be heard. Please try again.');
    } finally {
      if (keep.current) setState('idle');
    }
  }

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    let media;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      latest.current.onError(e && e.name === 'NotAllowedError'
        ? 'Microphone access is blocked. Allow it for this site in your browser to talk instead of typing.'
        : 'No microphone could be found.');
      return;
    }
    stream.current = media;
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const r = new MediaRecorder(media, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      release();
      const kept = r.__keep;
      const used = r.mimeType || type || 'audio/webm';
      const blob = new Blob(chunks.current, { type: used.split(';')[0] });
      chunks.current = [];
      if (kept && blob.size && keep.current) send(blob, used);
      else if (keep.current) setState('idle');
    };
    rec.current = r;
    r.start();
    setSeconds(0);
    setState('listening');
    const began = Date.now();
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSeconds(s);
      // Long enough for any question; past it, stop as if they had.
      if (s >= LONGEST && r.state === 'recording') { r.__keep = true; r.stop(); }
    }, 250);
  }, [state, release]);

  const stop = useCallback(() => {
    const r = rec.current;
    if (r && r.state === 'recording') { r.__keep = true; r.stop(); }
  }, []);

  const cancel = useCallback(() => {
    const r = rec.current;
    if (r && r.state === 'recording') { r.__keep = false; r.stop(); }
  }, []);

  return { state, seconds, start, stop, cancel };
}
