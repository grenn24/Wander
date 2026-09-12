'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LayoutGrid } from 'lucide-react';
import { getClient } from '@/lib/supabase';
import { initials } from '@/lib/util';

/**
 * The landing page's account control.
 *
 * It reads the session directly rather than through AppProvider, because that
 * provider is the sign-in gate: wrapping the landing page in it would show a
 * sign-in form to the very visitors the page exists to convince. This asks the
 * same question without acting on the answer.
 *
 * Signed-in visitors get separate, direct links to their trips and profile.
 */
export default function LandingAccount() {
  const [name, setName] = useState(null); // null = still asking

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

  // Nothing at all until the answer is known, rather than a button that
  // changes its mind a moment after the page settles.
  if (name === null) return <span className="lp-account-hold" aria-hidden="true" />;

  if (!name) return <Link className="btn primary sm" href="/trips">Open Wander</Link>;

  return (
    <div className="lp-account-links">
      <Link className="btn primary sm" href="/trips">
        <LayoutGrid size={15} aria-hidden="true" /> Your trips
      </Link>
      <Link href="/account" className="btn ghost sm who" aria-label={`Your profile — ${name}`}>
        <span className="who-mark" aria-hidden="true">{initials(name)}</span>
        <span className="who-full">{name}</span>
      </Link>
    </div>
  );
}
