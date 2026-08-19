'use client';
import { useState } from 'react';
import { saveConfig } from '@/lib/supabase';

export default function Setup({ onDone }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect(e) {
    e.preventDefault();
    setErr('');
    const u = url.trim().replace(/\/+$/, '');
    const k = key.trim();
    if (!/^https?:\/\/.+/.test(u)) { setErr('Project URL should look like https://abcdefgh.supabase.co'); return; }
    if (k.length < 20) { setErr('That anon key looks too short. Copy the full "anon public" key.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${u}/rest/v1/trips?select=id&limit=1`, {
        headers: { apikey: k, Authorization: `Bearer ${k}` },
      });
      if (res.status === 401 || res.status === 403) {
        // RLS blocking anonymous reads is the expected, correct response.
      } else if (res.status === 404) {
        setErr('Connected, but no "trips" table found. Run schema.sql in the Supabase SQL Editor first.');
        setBusy(false); return;
      } else if (!res.ok && res.status !== 200) {
        setErr(`Supabase replied ${res.status}. Double-check the URL and anon key.`);
        setBusy(false); return;
      }
      saveConfig(u, k);
      onDone();
    } catch (e2) {
      setErr('Could not reach that URL. Check the project URL and your connection.');
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate-card card">
        <div className="brand">
          <div className="brand-mark">✈</div>
          <h1>Wander</h1>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Connect your own Supabase project. Your data stays in your database — this app never
          sees it server-side.
        </p>
        <ol className="steps">
          <li>Create a free project at <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">supabase.com</a>.</li>
          <li>SQL Editor → paste <code>schema.sql</code> → Run.</li>
          <li>Authentication → Sign In / Providers → turn on <strong>Anonymous sign-ins</strong>.</li>
          <li>Project Settings → API → copy the URL and the <strong>anon public</strong> key below.</li>
        </ol>
        <form onSubmit={connect}>
          <div className="field">
            <label className="label" htmlFor="su">Project URL</label>
            <input id="su" className="input" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xxxxxxxx.supabase.co" autoComplete="off" />
          </div>
          <div className="field">
            <label className="label" htmlFor="sk">Anon public key</label>
            <input id="sk" className="input" value={key} onChange={(e) => setKey(e.target.value)}
              placeholder="eyJhbGciOi..." autoComplete="off" />
          </div>
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Checking…' : 'Connect'}
          </button>
          {err ? <div className="err">{err}</div> : null}
        </form>
        <p className="tiny dim" style={{ marginBottom: 0 }}>
          The anon key is designed to be public — row-level security in the schema is what protects
          your rows. Saved in this browser only.
        </p>
      </div>
    </div>
  );
}
