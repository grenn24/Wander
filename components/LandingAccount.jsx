'use client';
import { useEffect, useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutGrid } from 'lucide-react';
import { authStorageKey, installAccountHint, signingOutToken } from '@/lib/accountHint';

// Inlined at build time, so it must be spelled out in full.
const STORAGE_KEY = authStorageKey(process.env.NEXT_PUBLIC_SUPABASE_URL || '');

// What storage says, except for a session that has just been signed out of and
// is only waiting for the server to say so (lib/accountHint.js).
const read = () => installAccountHint(STORAGE_KEY, signingOutToken());

/**
 * The landing page's account control.
 *
 * Both versions are in the HTML the server sends, and CSS shows one of them
 * (app/landing.css) according to `data-account` on <html>. That attribute is
 * set by an inline script while the page is still being parsed
 * (lib/accountHint.js), so the right control is there in the first frame rather
 * than arriving after the page around it.
 *
 * It reads the session directly rather than through AppProvider, because that
 * provider is the sign-in gate: wrapping the landing page in it would show a
 * sign-in form to the very visitors the page exists to convince.
 *
 * What is stored is what counts. The SDK is asked afterwards — that is what
 * makes it refresh a stale token or throw out one the server has refused — but
 * its answer is never taken as "signed out" by itself: when it cannot reach the
 * server it says "no session" too, and a visitor with a flaky connection would
 * have lost their controls. A session the server rejects is removed from
 * storage, and re-reading storage is what notices.
 */
export default function LandingAccount() {
  const [name, setName] = useState(''); // only for the profile link's spoken name

  // Arriving from another page inside the app runs no inline script for this
  // document, so say it here, before the route's first paint.
  useLayoutEffect(() => {
    if (!STORAGE_KEY) return;
    const account = read();
    setName(account ? account.name : '');
  }, []);

  useEffect(() => {
    if (!STORAGE_KEY) return undefined;
    let alive = true;
    let stop = () => {};
    const follow = () => {
      if (!alive) return;
      const account = read();
      setName(account ? account.name : '');
    };

    // Another tab signing out, or this one coming back from the back/forward
    // cache with whatever it knew when it left.
    const onStorage = (e) => { if (!e.key || e.key === STORAGE_KEY) follow(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', follow);

    // The SDK is not needed to draw anything, so it stays off the path to the
    // first interaction and is fetched once the page is up.
    import('@/lib/supabase').then(({ getClient }) => {
      const client = getClient();
      if (!client || !alive) return;
      client.auth.getSession().then(follow, follow);
      // Nothing here calls back into the SDK, so it is safe to run inside its lock.
      const { data } = client.auth.onAuthStateChange(follow);
      stop = () => data.subscription.unsubscribe();
    }).catch(() => { /* the hint stands */ });

    return () => {
      alive = false;
      stop();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', follow);
    };
  }, []);

  return (
    <div className="lp-account">
      <Link className="btn primary sm lp-account-out" href="/trips">Open Wander</Link>
      <div className="lp-account-in">
        <Link className="btn primary sm" href="/trips">
          <LayoutGrid size={15} aria-hidden="true" /> Your trips
        </Link>
        <Link className="lp-avatar" href="/account"
          aria-label={name ? `Your profile, ${name}` : 'Your profile'}
          data-tip={name || 'Your profile'} />
      </div>
    </div>
  );
}
