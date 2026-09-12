'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { getClient, readConfig, missingEnv, configWarning } from '@/lib/supabase';
import { humanError } from '@/lib/util';
import Toasts from '@/components/Toasts';
import ConfigError from '@/components/ConfigError';
import { keepCalendar } from '@/lib/gcal';
import { clearDownloads, setDownloadOwner } from '@/public/offline-store';
import Loading from '@/components/Loading';
import AuthScreen from '@/components/AuthScreen';
import { observeSession } from '@/lib/sessionRecovery';

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
  const [sessionRevision, setSessionRevision] = useState(0);
  const sessionRecovery = useRef(null);
  const retrySession = useCallback(() => sessionRecovery.current?.recover(), []);
  const [displayName, setDisplayName] = useState('');
  const [fatal, setFatal] = useState('');
  const [fatalKind, setFatalKind] = useState('session'); // config | session
  const [toasts, setToasts] = useState([]);
  /*
   * The Google hand-off, which takes a moment and which the calendar panel
   * needs to know about.
   *
   * Coming back from consent is a full page load: the panel mounts and asks
   * whether a calendar is connected at the same instant the token is being
   * posted to the server. The panel used to win that race and report no —
   * correctly, at that instant, and wrongly by the time anyone read it.
   */
  const [calendar, setCalendar] = useState({ at: 0, saving: false, error: '' });

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

    let alive = true;
    // Once per arrival, not once per token refresh.
    const kept = { current: false };

    const settle = (s) => {
      if (!alive) return;
      if (s?.user?.id) setDownloadOwner(s.user.id).catch(() => {});
      else clearDownloads().catch(() => {});
      setSession(s);
      setDisplayName(nameOf(s));
      setPhase(s ? 'ready' : 'signedout');

      /*
       * Google's tokens exist in this tab for exactly one moment.
       *
       * Supabase puts `provider_token` and `provider_refresh_token` on the
       * session as the OAuth redirect lands and does not keep them — a
       * refresh a few minutes later has neither. So the instant one appears
       * it goes to the server, which is the only place it can usefully live.
       * Failures are quiet on purpose: this fires on every ordinary sign-in
       * too, and someone who only wanted to log in has nothing to fix.
       */
      if (s && s.provider_refresh_token && !kept.current) {
        kept.current = true;
        setCalendar({ at: 0, saving: true, error: '' });
        keepCalendar(client, {
          refresh_token: s.provider_refresh_token,
          access_token: s.provider_token || '',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/calendar.readonly'
            + ' https://www.googleapis.com/auth/calendar.events',
        })
          .then(() => setCalendar({ at: Date.now(), saving: false, error: '' }))
          .catch((e) => {
            kept.current = false;
            /*
             * Not silent any more. This also runs on an ordinary Google
             * sign-in, where nobody asked for a calendar and the failure is
             * none of their business — but the panel is the only thing that
             * reads this, and it is only on screen when somebody did ask.
             */
            setCalendar({ at: 0, saving: false, error: (e && e.message) || 'That did not save.' });
          });
      }
    };

    const recovery = observeSession(client, {
      onSession: settle,
      // Only explicit restoration attempts retry failed views. Token refresh
      // events from a rejected read must not create an endless retry loop.
      onRecovered: () => setSessionRevision((value) => value + 1),
      onError: (e) => {
        if (!alive) return;
        setFatal(humanError(e));
        setFatalKind('session');
        // A temporary reconnect failure must not discard open editors or downloads.
        setPhase((previous) => previous === 'ready' ? previous : 'error');
      },
      windowTarget: window,
      documentTarget: document,
    });
    sessionRecovery.current = recovery;
    return () => { alive = false; recovery.dispose(); sessionRecovery.current = null; };
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

  /**
   * Asking for the calendar, which is a separate question from signing in.
   *
   * Kept apart deliberately: reading somebody's diary is not the price of
   * entry to a trip planner, and a consent screen listing it at the door would
   * make it look like one. This runs when they ask for it and not before.
   *
   * `access_type=offline` is what makes Google issue a refresh token at all,
   * and `prompt=consent` is what makes it issue one again for somebody who has
   * agreed before — without it a reconnection comes back with an hour's access
   * and no way to renew it.
   */
  const connectCalendar = useCallback(async () => {
    const back = `${window.location.pathname}${window.location.search}`;
    const options = {
      redirectTo: `${window.location.origin}${back}`,
      scopes: 'https://www.googleapis.com/auth/calendar.readonly'
        + ' https://www.googleapis.com/auth/calendar.events',
      queryParams: { access_type: 'offline', prompt: 'consent' },
    };

    /*
     * Linking, not signing in — when there is anyone to link to.
     *
     * signInWithOAuth means "sign in as whoever this Google account is". For
     * somebody who signed up with an email and a password, that is a different
     * account from the one they are sitting in: they would come back from
     * Google to an empty trip list, with everything they had written still
     * there and no longer theirs. Adding a provider to the account already
     * signed in is a different call.
     *
     * If Google is already on the account, there is nothing to link and the
     * ordinary sign-in is right: it lands on the same user and comes back with
     * the fresh consent we asked for.
     */
    const linked = !!user && (user.identities || []).some((i) => i.provider === 'google');
    const auth = supabase.auth;

    if (!linked && typeof auth.linkIdentity === 'function') {
      const { error } = await auth.linkIdentity({ provider: 'google', options });
      if (!error) return;
      /*
       * Manual linking is off in the project settings, which is the default.
       * Falling through to a plain sign-in would quietly move them to another
       * account, so this stops and says what to turn on instead.
       */
      if (/manual linking|not enabled|disabled/i.test(error.message || '')) {
        throw new Error('Turn on "Allow manual linking" in Supabase → Authentication → '
          + 'Sign In / Providers before connecting a calendar to this account.');
      }
      throw error;
    }

    const { error } = await auth.signInWithOAuth({ provider: 'google', options });
    if (error) throw error;
  }, [supabase, user]);

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
    try { await clearDownloads(); }
    catch { pushToast('Could not clear offline storage. Clear this site’s browser data to remove any downloads.'); }
    router.replace('/');
    await supabase.auth.signOut();
  }, [supabase, router, pushToast]);

  const value = useMemo(() => ({
    supabase, user, session, sessionRevision, phase, displayName, saveDisplayName,
    signIn, signUp, signInWithGoogle, connectCalendar, calendar, sendReset, signOut,
    pushToast, dismissToast, fail,
  }), [
    supabase, user, session, sessionRevision, phase, displayName, saveDisplayName,
    signIn, signUp, signInWithGoogle, connectCalendar, calendar, sendReset, signOut,
    pushToast, dismissToast, fail,
  ]);

  if (phase === 'boot') {
    return <div className="gate"><Loading label="Getting your trips ready" /></div>;
  }

  if (phase === 'error') {
    return (
      <ConfigError kind={fatalKind} fatal={fatal} missing={missingEnv()} onRetry={retrySession}
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
