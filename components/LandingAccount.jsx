'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, LayoutGrid } from 'lucide-react';
import { getClient } from '@/lib/supabase';
import Popover from '@/components/Popover';
import { initials } from '@/lib/util';

/**
 * The landing page's account control.
 *
 * It reads the session directly rather than through AppProvider, because that
 * provider is the sign-in gate: wrapping the landing page in it would show a
 * sign-in form to the very visitors the page exists to convince. This asks the
 * same question without acting on the answer.
 *
 * Signed out it is the button that was always here; signed in it says who you
 * are and offers the way back to your trips.
 */
export default function LandingAccount() {
  const [name, setName] = useState(null); // null = still asking
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const btn = useRef(null);

  useEffect(() => {
    const client = getClient();
    if (!client) { setName(''); return undefined; }
    let alive = true;

    const take = (session) => {
      if (!alive) return;
      const u = session && session.user;
      if (!u) { setName(''); setEmail(''); return; }
      const meta = u.user_metadata || {};
      setName(meta.display_name || meta.full_name || meta.name
        || (u.email || '').split('@')[0] || 'Traveller');
      setEmail(u.email || '');
    };

    client.auth.getSession().then(({ data }) => take(data.session)).catch(() => take(null));
    const { data } = client.auth.onAuthStateChange((_e, s) => take(s));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);

  async function signOut() {
    setOpen(false);
    const client = getClient();
    if (client) await client.auth.signOut();
  }

  // Nothing at all until the answer is known, rather than a button that
  // changes its mind a moment after the page settles.
  if (name === null) return <span className="lp-account-hold" aria-hidden="true" />;

  if (!name) return <Link className="btn primary sm" href="/trips">Open Wander</Link>;

  return (
    <>
      <button ref={btn} className="btn ghost sm who" type="button"
        aria-haspopup="menu" aria-expanded={open} aria-label={`Account — ${name}`}
        onClick={() => setOpen((o) => !o)}>
        <span className="who-mark" aria-hidden="true">{initials(name)}</span>
        <span className="who-full">{name}</span>
        <ChevronDown size={14} className="who-chev" aria-hidden="true" />
      </button>

      <Popover anchorEl={btn.current} open={open} width={228} onClose={() => setOpen(false)}>
        <div className="act-menu" role="menu">
          <p className="menu-who">
            {name}
            {email ? <span className="menu-who-sub">{email}</span> : null}
          </p>
          <Link href="/trips" role="menuitem" onClick={() => setOpen(false)}>
            <LayoutGrid size={15} /> Your trips
          </Link>
          <div className="menu-rule" />
          <button type="button" role="menuitem" onClick={signOut}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </Popover>
    </>
  );
}
