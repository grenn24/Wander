'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { getClient, readConfig, missingEnv, configWarning } from '@/lib/supabase';
import { ensureLocalName, writeLocalName, humanError } from '@/lib/util';
import Toasts from '@/components/Toasts';
import ConfigError from '@/components/ConfigError';

const Ctx = createContext(null);

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

function nameOf(session, fallback) {
  if (!session || !session.user) return fallback;
  const meta = session.user.user_metadata || {};
  return meta.display_name || fallback;
}

/**
 * Owns everything that outlives a single trip: the Supabase client, the guest
 * session, the display name and the toast stack. Trip data lives in
 * TripProvider instead, so switching trips does not tear this down.
 */
export default function AppProvider({ children }) {
  const [phase, setPhase] = useState('boot'); // boot | error | ready
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [fatal, setFatal] = useState('');
  const [fatalKind, setFatalKind] = useState('session'); // config | session
  const [toasts, setToasts] = useState([]);

  /* ----------------------------------------------------------- toasts --- */
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((message, opts) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, ...(opts || {}) }].slice(-3));
  }, []);

  const fail = useCallback((err) => {
    pushToast(humanError(err), { kind: 'error' });
  }, [pushToast]);

  /* ------------------------------------------------ boot + guest session -- */
  useEffect(() => {
    if (!readConfig()) { setFatalKind('config'); setPhase('error'); return undefined; }
    const client = getClient();
    setSupabase(client);

    let sub;
    let alive = true;
    (async () => {
      const localName = ensureLocalName();
      let current = null;
      try {
        const { data } = await client.auth.getSession();
        current = data.session || null;
        if (!current) {
          const { data: anon, error } = await client.auth.signInAnonymously({
            options: { data: { display_name: localName } },
          });
          if (error) throw error;
          current = anon.session || null;
        }
      } catch (e) {
        if (!alive) return;
        setFatal(e && e.message ? e.message : 'Could not start a session.');
        setFatalKind('session');
        setPhase('error');
        return;
      }
      if (!alive) return;
      setSession(current);
      setDisplayName(nameOf(current, localName));
      setPhase('ready');
      const res = client.auth.onAuthStateChange((_evt, s) => { if (s) setSession(s); });
      sub = res.data.subscription;
    })();

    return () => { alive = false; if (sub) sub.unsubscribe(); };
  }, []);

  const user = session ? session.user : null;

  const saveDisplayName = useCallback(async (name) => {
    const clean = (name || '').trim().slice(0, 40) || 'Guest';
    writeLocalName(clean);
    setDisplayName(clean);
    if (!supabase || !user) return clean;
    await supabase.auth.updateUser({ data: { display_name: clean } });
    await supabase.from('trip_members').update({ display_name: clean }).eq('user_id', user.id);
    return clean;
  }, [supabase, user]);

  const value = useMemo(() => ({
    supabase, user, session, phase, displayName, saveDisplayName,
    pushToast, dismissToast, fail,
  }), [supabase, user, session, phase, displayName, saveDisplayName, pushToast, dismissToast, fail]);

  if (phase === 'boot') {
    return <div className="gate"><div className="muted">Loading…</div></div>;
  }

  if (phase === 'error') {
    return (
      <ConfigError kind={fatalKind} fatal={fatal} missing={missingEnv()}
        warning={configWarning()} apiUrl={(readConfig() || {}).url || ''} />
    );
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      <Toasts items={toasts} onDismiss={dismissToast} />
    </Ctx.Provider>
  );
}

/** Theme is independent of auth, so it is exported separately. */
export function useTheme() {
  const [theme, setTheme] = useState('system');
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    try {
      const saved = localStorage.getItem('tp.theme');
      if (saved) setTheme(saved);
    } catch (e) { /* ignore */ }
  }, []);

  const apply = useCallback((next) => {
    setTheme(next);
    try {
      if (next === 'system') {
        localStorage.removeItem('tp.theme');
        document.documentElement.removeAttribute('data-theme');
      } else {
        localStorage.setItem('tp.theme', next);
        document.documentElement.setAttribute('data-theme', next);
      }
    } catch (e) { /* ignore */ }
  }, []);

  const toggle = useCallback(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    const dark = attr
      ? attr === 'dark'
      : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    apply(dark ? 'light' : 'dark');
  }, [apply]);

  return { theme, apply, toggle };
}
