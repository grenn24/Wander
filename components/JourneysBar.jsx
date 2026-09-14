'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import BrandMark from '@/components/BrandMark';
import HomeNav from '@/components/HomeNav';
import { getClient } from '@/lib/supabase';
import { initials } from '@/lib/util';

/**
 * The bar on journey pages.
 *
 * Journeys are readable signed out — they are the best argument for the app
 * there is — so these pages cannot sit behind the provider that shows the
 * sign-in form. Like the landing page, this asks whether someone is signed in
 * without acting on the answer: signed in, it is the same bar as Trips and
 * Globe; signed out, it is a way in.
 */
export default function JourneysBar() {
  const [name, setName] = useState(null); // null = still asking, '' = signed out

  useEffect(() => {
    const client = getClient();
    if (!client) { setName(''); return undefined; }
    let alive = true;
    const take = (session) => {
      if (!alive) return;
      const u = session && session.user;
      if (!u) { setName(''); return; }
      const meta = u.user_metadata || {};
      setName(meta.display_name || meta.full_name || meta.name
        || (u.email || '').split('@')[0] || 'Traveller');
    };
    client.auth.getSession().then(({ data }) => take(data.session)).catch(() => take(null));
    const { data } = client.auth.onAuthStateChange((_e, s) => take(s));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);

  return (
    <header className="topbar">
      <Link href={name ? '/trips' : '/'} className="brand-link" aria-label="Wander">
        <BrandMark />
        <span className="brand-word">Wander</span>
      </Link>
      {name ? <HomeNav active="journeys" /> : null}
      <div className="grow" />
      {name === null ? null : name ? (
        <Link href="/account" className="btn ghost sm who" data-tip="Account"
          aria-label={`Account — ${name}`}>
          <span className="who-mark" aria-hidden="true">{initials(name)}</span>
          <span className="who-full">{name}</span>
        </Link>
      ) : (
        <Link href="/trips" className="btn primary sm">Sign in</Link>
      )}
    </header>
  );
}
