'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { getClient, readConfig, missingEnv, configWarning } from '@/lib/supabase';
import { humanError } from '@/lib/util';
import Toasts from '@/components/Toasts';
import ConfigError from '@/components/ConfigError';
import Loading from '@/components/Loading';
import AuthScreen from '@/components/AuthScreen';

const Ctx = createContext(null);

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

/**
 * What to call someone. Their own answer first, then whatever the provider
 * told us, then the part of their address before the @ — which is a better
 * guess than "Guest" and is what the database falls back to as well.
 */
function nameOf(session) {
  const u = session && session.user;
  if (!u) return '';
  const meta = u.user_metadata || {};
  return meta.display_name
    || meta.full_name
    || meta.name
    || (u.email || '').split('@')[0]
    || 'Traveller';
}

/**
 * Owns everything that outlives a single trip: the Supabase client, the
 * session, the display name and the toast stack. Trip data lives in
 * TripProvider instead, so switching trips does not tear this down.
 *
 * Nothing inside renders without a signed-in user. Gating here rather than
 * per-route means a shared link works the same way as anything else: the
 * address is kept, the sign-in appears over it, and afterwards the page they
 * asked for is already the page they are on.
 */
export default function AppProvider({ children }) {
  const router = useRouter();
  const [phase, setPhase] = useState('boot'); // boot | error | signedout | ready
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

  /* -------------------------------------------------------- the session -- */
  useEffect(() => {
    if (!readConfig()) { setFatalKind('config'); setPhase('error'); return undefined; }
    const client = getClient();
    setSupabase(client);

    let sub;
    let alive = true;

    const settle = (s) => {
      if (!alive) return;
      setSession(s);
      setDisplayName(nameOf(s));
      setPhase(s ? 'ready' : 'signedout');
    };

    (async () => {
      try {
        const { data } = await client.auth.getSession();
        settle(data.session || null);
      } catch (e) {
        if (!alive) return;
        setFatal(e && e.message ? e.message : 'Could not reach the account service.');
        setFatalKind('session');
        setPhase('error');
        return;
      }
      // Signing in, signing out and token refreshes all arrive here, so the
      // gate opens and closes on its own rather than on a reload.
      const res = client.auth.onAuthStateChange((_evt, s) => settle(s || null));
      sub = res.data.subscription;
    })();

    return () => { alive = false; if (sub) sub.unsubscribe(); };
  }, []);

  const user = session ? session.user : null;

  const saveDisplayName = useCallback(async (name) => {
    const clean = (name || '').trim().slice(0, 40);
    if (!clean || !supabase || !user) return displayName;
    setDisplayName(clean);
    await supabase.auth.updateUser({ data: { display_name: clean } });
    await supabase.from('trip_members').update({ display_name: clean }).eq('user_id', user.id);
    return clean;
  }, [supabase, user, displayName]);

  /* ------------------------------------------------------- ways in and out -- */

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, [supabase]);

  const signUp = useCallback(async (email, password, name) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Carried through sign-up so the first trip is already filed under a
      // person rather than an address.
      options: { data: { display_name: (name || '').trim().slice(0, 40) } },
    });
    if (error) throw error;
    // With confirmations on, there is no session yet and the inbox is the next
    // step; the caller says so rather than appearing to have done nothing.
    return !!(data && data.session);
  }, [supabase]);

  const signInWithGoogle = useCallback(async () => {
    const back = `${window.location.pathname}${window.location.search}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Comes back to the page they were trying to reach, which for a shared
      // link is the trip itself.
      options: { redirectTo: `${window.location.origin}${back}` },
    });
    if (error) throw error;
  }, [supabase]);

  const sendReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/trips`,
    });
    if (error) throw error;
  }, [supabase]);

  const signOut = useCallback(async () => {
    /*
     * Leave for the landing page first, then drop the session. Signing out is
     * leaving, not a request to sign back in — clearing the session while
     * still on a gated route just replaces the app with the sign-in form,
     * which reads as being bounced rather than as having left.
     */
    router.replace('/');
    await supabase.auth.signOut();
  }, [supabase, router]);

  const value = useMemo(() => ({
    supabase, user, session, phase, displayName, saveDisplayName,
    signIn, signUp, signInWithGoogle, sendReset, signOut,
    pushToast, dismissToast, fail,
  }), [
    supabase, user, session, phase, displayName, saveDisplayName,
    signIn, signUp, signInWithGoogle, sendReset, signOut,
    pushToast, dismissToast, fail,
  ]);

  if (phase === 'boot') {
    return <div className="gate"><Loading label="Getting your trips ready" /></div>;
  }

  if (phase === 'error') {
    return (
      <ConfigError kind={fatalKind} fatal={fatal} missing={missingEnv()}
        warning={configWarning()} apiUrl={(readConfig() || {}).url || ''} />
    );
  }

  if (phase === 'signedout') {
    return (
      <Ctx.Provider value={value}>
        <AuthScreen />
        <Toasts items={toasts} onDismiss={dismissToast} />
      </Ctx.Provider>
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
