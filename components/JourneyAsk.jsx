'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUp, Square, X } from 'lucide-react';
import { getClient } from '@/lib/supabase';
import { paragraphs } from '@/lib/journeyFormat';
import s from './Journeys.module.css';

const SUGGESTIONS = [
  'Can I do this without a car?',
  'What should I book ahead?',
  'Where is a good base to stay?',
  'How would I fit this into fewer days?',
];

/* The model is told to write plain text; this catches the odd lapse. */
const tidy = (text) => String(text || '').replace(/\*\*|__/g, '').replace(/^#+\s*/gm, '');

/**
 * Questions about a journey, asked while reading it.
 *
 * The answer knows where the reader is — the section on screen, or a passage
 * they highlighted — and names places the way the journal does, so a name in
 * an answer opens the same card as a name in the text. The conversation lives
 * with the page, so closing the panel to keep reading loses nothing.
 */
export default function JourneyAsk({ doc, reading, quote, onClearQuote, messages, setMessages, renderText, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(null);
  const stop = useRef(null);
  const input = useRef(null);
  const end = useRef(null);

  useEffect(() => {
    const client = getClient();
    if (!client) { setSignedIn(false); return; }
    client.auth.getSession().then(({ data }) => setSignedIn(!!(data && data.session)));
  }, []);
  // After the drawer has taken focus for itself.
  useEffect(() => { const t = setTimeout(() => input.current && input.current.focus(), 60); return () => clearTimeout(t); }, [quote]);
  useEffect(() => { if (end.current) end.current.scrollIntoView({ block: 'end' }); }, [messages]);
  useEffect(() => () => { if (stop.current) stop.current.abort(); }, []);

  async function ask(said) {
    const question = String(said || '').trim();
    if (!question || busy) return;
    setError('');
    setText('');
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    const passage = quote || '';
    setMessages((m) => [...m, { role: 'user', content: question, quote: passage }, { role: 'assistant', content: '' }]);
    onClearQuote();
    setBusy(true);
    const ctrl = new AbortController();
    stop.current = ctrl;
    try {
      const client = getClient();
      const { data } = client ? await client.auth.getSession() : { data: null };
      const token = data && data.session && data.session.access_token;
      if (!token) { setSignedIn(false); throw new Error(''); }
      const res = await fetch('/api/journeys/ask', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          slug: doc.slug, question, quote: passage, section: reading ? reading.index : null, history,
        }),
      });
      if (res.status === 401) { setSignedIn(false); throw new Error(''); }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Something went wrong. Please try again.');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let got = '';
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        got += decoder.decode(value, { stream: true });
        const now = got;
        setMessages((m) => [...m.slice(0, -1), { role: 'assistant', content: now }]);
      }
      if (!got.trim()) throw new Error('No answer came back. Please try again.');
    } catch (e) {
      setMessages((m) => {
        const last = m[m.length - 1];
        return last && last.role === 'assistant' && !last.content ? m.slice(0, -1) : m;
      });
      if (e.name !== 'AbortError' && e.message) setError(e.message);
    } finally {
      setBusy(false);
      stop.current = null;
    }
  }

  return (
    <div className={s.ask}>
      <div className={s.mineHead}>
        <h2 className={s.mineTitle}>Ask about this journey</h2>
        <button type="button" className="btn ghost icon-btn" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {reading ? <p className={s.askReading}>Reading <b>{reading.label}</b></p> : null}

      <div className={s.askLog} aria-live="polite">
        {!messages.length ? (
          <div className={s.askEmpty}>
            <p>Ask anything while you read: what a place is like, what to book, how to make it shorter or slower.</p>
            <div className={s.chips}>
              {SUGGESTIONS.map((q) => (
                <button key={q} type="button" className={s.chip} disabled={busy || signedIn === false} onClick={() => ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : messages.map((m, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className={m.role === 'user' ? s.askMe : s.askThem}>
            {m.quote ? <blockquote className={s.askQuote}>{m.quote}</blockquote> : null}
            {m.role === 'user' ? <p>{m.content}</p>
              : m.content ? paragraphs(tidy(m.content)).map((para, k) => <p key={k}>{renderText(para)}</p>)
                : <p className={s.askTyping} aria-label="Writing an answer"><span /><span /><span /></p>}
          </div>
        ))}
        <div ref={end} />
      </div>

      {error ? <p className={s.askError} role="alert">{error}</p> : null}
      {signedIn === false ? (
        <p className={s.askSignin}>
          <Link href="/trips" className="btn primary sm">Sign in</Link> to ask questions about journeys.
        </p>
      ) : (
        <form className={s.askForm} onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          {quote ? (
            <div className={s.askQuoteChip}>
              <span>“{quote}”</span>
              <button type="button" aria-label="Remove the highlighted passage" onClick={onClearQuote}><X size={14} /></button>
            </div>
          ) : null}
          <textarea ref={input} rows={1} value={text} maxLength={600} aria-label="Your question"
            placeholder={quote ? 'Ask about this passage' : 'Ask about this journey'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }} />
          {busy ? (
            <button type="button" className="btn icon-btn" aria-label="Stop" onClick={() => stop.current && stop.current.abort()}>
              <Square size={15} />
            </button>
          ) : (
            <button type="submit" className="btn primary icon-btn" aria-label="Ask" disabled={!text.trim()}>
              <ArrowUp size={18} />
            </button>
          )}
        </form>
      )}
    </div>
  );
}
