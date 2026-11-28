'use client';

import { useState } from 'react';
import { Plane, Check, Loader2, TriangleAlert, Search } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import { authHeader } from '@/lib/supabase';
import { cleanHome, homeOf } from '@/lib/home';

/**
 * Where trips start, on the Account page.
 *
 * The planner adds the flights there and home from it (app/api/flights), and
 * asks for it the first time it is missing; this is where it is seen and
 * changed. Kept on the account (lib/home.js), so it follows the person rather
 * than any trip.
 */
export default function HomeAirports() {
  const { supabase, user } = useApp();
  const home = homeOf(user);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null); // { home, around }
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function find(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setBusy('find'); setError(''); setFound(null);
    try {
      const res = await fetch('/api/airports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ query: q }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not look that up. Try again.'); return; }
      setFound(body);
      setPicked(body.home.airports);
    } catch (err) {
      setError('The connection dropped. Try again.');
    } finally {
      setBusy('');
    }
  }

  async function save(next) {
    if (!supabase || busy) return;
    setBusy(next ? 'save' : 'remove'); setError('');
    const { error: err } = await supabase.auth.updateUser({ data: { home: next } });
    setBusy('');
    if (err) { setError('Could not save your home. Try again.'); return; }
    setEditing(false); setFound(null); setQuery('');
  }

  const toggle = (code) => setPicked((now) => (now.includes(code)
    ? now.filter((c) => c !== code) : [...now, code].slice(0, 4)));
  const chosen = found ? cleanHome({ ...found.home, airports: picked }) : null;

  return (
    <section className="card tset">
      <h3 className="tset-h"><Plane size={15} aria-hidden="true" /> Home</h3>
      <p className="tset-hint">
        {home
          ? `Trips you plan start in ${home.label}. The planner adds flights from ${home.airports.join(', ')} and back.`
          : 'Where your trips start. The planner adds the flights there and back from it.'}
      </p>

      {!editing ? (
        <div className="chiprow">
          <button className="btn" type="button" onClick={() => { setEditing(true); setError(''); }}>
            {home ? 'Change home' : 'Set your home'}
          </button>
          {home ? (
            <button className="btn danger" type="button" disabled={!!busy} onClick={() => save(null)}>
              {busy === 'remove' ? <Loader2 size={15} className="spin" /> : null} Remove
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <form className="tset-row" onSubmit={find}>
            <input className="input" value={query} autoComplete="address-level2"
              aria-label="Your home town, city or airport"
              placeholder="Town, city or airport" onChange={(e) => setQuery(e.target.value)} />
            <button className="btn" type="submit" disabled={!query.trim() || !!busy}>
              {busy === 'find' ? <Loader2 size={15} className="spin" /> : <Search size={15} />} Find
            </button>
          </form>

          {found ? (
            <fieldset className="home-airports">
              <legend className="small">Airports you fly from, near {found.home.label}</legend>
              <div className="cmdq-opts">
                {found.around.map((a) => {
                  const on = picked.includes(a.code);
                  return (
                    <button type="button" key={a.code} className={`cmdq-opt${on ? ' is-on' : ''}`}
                      aria-pressed={on} onClick={() => toggle(a.code)}>
                      <span className="cmdq-box" aria-hidden="true">{on ? <Check size={12} /> : null}</span>
                      <span className="cmdq-opt-main">
                        <span className="cmdq-opt-label">{a.code} · {a.name}</span>
                        <span className="cmdq-opt-detail">{a.km} km away</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <div className="chiprow" style={{ marginTop: 12 }}>
            <button className="btn primary" type="button" disabled={!chosen || !!busy}
              onClick={() => save(chosen)}>
              {busy === 'save' ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save
            </button>
            <button className="btn ghost" type="button" disabled={!!busy}
              onClick={() => { setEditing(false); setFound(null); setError(''); }}>
              Cancel
            </button>
          </div>
        </>
      )}

      {error ? <p className="err" style={{ marginTop: 12 }}><TriangleAlert size={14} /> {error}</p> : null}
    </section>
  );
}
