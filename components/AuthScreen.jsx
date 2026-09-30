'use client';
import { useEffect, useState } from 'react';
import { Loader2, Mail, ArrowLeft } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import BrandMark from '@/components/BrandMark';

/**
 * The way in. Shown by AppProvider in place of the app whenever there is no
 * session, so it inherits whatever address was asked for — a shared trip link
 * lands here, and signing in continues to that trip rather than dumping the
 * reader on a home page to find it again.
 *
 * Google first because it is one tap and no password to invent; email below
 * for anyone who would rather not, or does not have one.
 */

const MIN_PASSWORD = 8;

/*
 * Why this person is being asked to sign in.
 *
 * The gate takes over whatever address was requested, so it already knows what
 * was being reached for — and saying so is the difference between an
 * interruption and a step. Someone who just described a trip should be told
 * their plan is waiting, not shown a bare form and left to wonder whether
 * their sentence survived.
 */
const ERRANDS = [
  {
    at: (p) => p.startsWith('/join/'),
    title: 'Sign in to open this trip',
    sub: 'You will be added to it straight after.',
  },
  {
    at: (p) => p.startsWith('/plan'),
    title: 'Sign in to see your plan',
    sub: 'We will start building it the moment you are in, and save it to your account.',
  },
  {
    at: (p) => p.startsWith('/trips'),
    title: 'Sign in to reach your trips',
    sub: 'Everything you have planned is waiting.',
  },
];

export default function AuthScreen() {
  const { signIn, signUp, signInWithGoogle, sendReset } = useApp();

  const [mode, setMode] = useState('in'); // in | up | reset
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [said, setSaid] = useState('');

  /*
   * Coming back from Google with the Back button.
   *
   * Leaving for Google freezes this page in the back/forward cache with `busy`
   * still standing, and Back restores it exactly so: every button dimmed and a
   * spinner that nothing will ever stop, since no request is in flight. A
   * restored page is `persisted`; a fresh load starts with busy false anyway.
   */
  useEffect(() => {
    const restored = (e) => { if (e.persisted) setBusy(false); };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const errand = ERRANDS.find((e) => e.at(path)) || null;

  function fault(e) {
    const m = (e && e.message) || '';
    // Supabase says "Invalid login credentials" for both halves, which is
    // correct — saying which one was wrong tells a stranger the address exists.
    if (/invalid login/i.test(m)) return 'That email and password do not match.';
    if (/already registered|already exists/i.test(m)) return 'There is already an account with that email. Try signing in.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts just now. Wait a minute and try again.';
    return m || 'Something went wrong. Please try again.';
  }

  async function submit(e) {
    e.preventDefault();
    setErr(''); setSaid('');

    if (mode === 'up' && !name.trim()) { setErr('What should we call you?'); return; }
    if (mode !== 'reset' && password.length < MIN_PASSWORD && mode === 'up') {
      setErr(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    try {
      if (mode === 'reset') {
        await sendReset(email.trim());
        setSaid('Check your email for a link to set a new password.');
      } else if (mode === 'up') {
        const signedIn = await signUp(email.trim(), password, name);
        // No session means confirmations are on and the inbox is the next step.
        if (!signedIn) setSaid('Check your email to confirm the address, then sign in.');
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e2) {
      setErr(fault(e2));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setErr('');
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setErr(fault(e));
      setBusy(false);
    }
    // On success the browser leaves for Google, so busy is left standing until
    // it comes back: a fresh load resets it, the pageshow effect above covers
    // Back.
  }

  return (
    <div className="gate authgate">
      <div className="auth card">
        <div className="auth-brand">
          <BrandMark />
          <span className="brand-word">Wander</span>
        </div>

        <h1 className="auth-title">
          {mode === 'up' ? 'Create your account'
            : mode === 'reset' ? 'Reset your password'
              : errand ? errand.title
                : 'Sign in'}
        </h1>
        {errand && mode !== 'reset' ? (
          <p className="auth-sub">{errand.sub}</p>
        ) : null}

        {mode !== 'reset' ? (
          <>
            <button className="btn lg auth-google" type="button" disabled={busy} onClick={google}>
              <GoogleMark /> Continue with Google
            </button>
            <div className="auth-or"><span>or</span></div>
          </>
        ) : null}

        <form onSubmit={submit}>
          {mode === 'up' ? (
            <div className="field">
              <label className="label" htmlFor="au-name">Your name</label>
              <input id="au-name" className="input" value={name} autoComplete="name"
                placeholder="Sam Tan" onChange={(e) => setName(e.target.value)} />
              <p className="tiny dim auth-hint">This is what the others on a trip will see.</p>
            </div>
          ) : null}

          <div className="field">
            <label className="label" htmlFor="au-email">Email</label>
            <input id="au-email" className="input" type="email" required value={email}
              autoComplete="email" placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)} />
          </div>

          {mode !== 'reset' ? (
            <div className="field">
              <label className="label" htmlFor="au-pass">Password</label>
              <input id="au-pass" className="input" type="password" required value={password}
                autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                placeholder={mode === 'up' ? `At least ${MIN_PASSWORD} characters` : ''}
                onChange={(e) => setPassword(e.target.value)} />
            </div>
          ) : null}

          {err ? <div className="err">{err}</div> : null}
          {said ? <p className="auth-said"><Mail size={14} /> {said}</p> : null}

          <button className="btn primary lg auth-go" type="submit" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : null}
            {mode === 'up' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
          </button>
        </form>

        <div className="auth-alt">
          {mode === 'in' ? (
            <>
              <button type="button" className="linkbtn" onClick={() => { setMode('up'); setErr(''); setSaid(''); }}>
                Create an account
              </button>
              <button type="button" className="linkbtn" onClick={() => { setMode('reset'); setErr(''); setSaid(''); }}>
                Forgot password?
              </button>
            </>
          ) : (
            <button type="button" className="linkbtn" onClick={() => { setMode('in'); setErr(''); setSaid(''); }}>
              <ArrowLeft size={13} /> Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Google's mark, inline so the button does not wait on a network request. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
