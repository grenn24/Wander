'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Plane, Sun, Moon, SunMoon, ChevronDown, LogOut } from 'lucide-react';
import { useApp, useTheme } from '@/components/AppProvider';
import Popover from '@/components/Popover';
import Presence from '@/components/Presence';
import { initials } from '@/lib/util';

/**
 * Global chrome. `children` slots into the middle for page-specific context
 * (a trip name, a breadcrumb); presence avatars are passed in only where they
 * mean something, which is inside a trip.
 *
 * On phones this collapses to the platform convention — back, title, and two
 * icon actions — because a row of words at 375px is a queue, not a toolbar.
 * Getting down to two meant deciding what a permanent slot is worth: the theme
 * switch is a preference set once and moved into the account menu, and the
 * presence pill has nothing to say while you are the only one here, so on a
 * phone it waits until somebody else arrives.
 *
 * The trailing control is always the account menu: your name opens it, and
 * signing out lives there on every page rather than only inside a trip.
 * `menu` adds page-specific items above the account ones — [{ id, label,
 * icon, href | onClick }].
 */
export default function TopBar({ children, online = [], menu = [], tools = null }) {
  const { displayName, user, signOut } = useApp();
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === 'dark' ? Sun : theme === 'light' ? Moon : SunMoon;
  const themeWord = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';
  const ref = useRef(null);
  const menuBtn = useRef(null);
  const [open, setOpen] = useState(false);
  const who = displayName || 'Guest';

  /*
   * Sticky children below are offset by --topbar-h, and the bar's real height
   * moves with the breakpoint, the font and the presence chips. Measuring it
   * is the only version of this that cannot drift; the CSS value is the
   * fallback for the first paint.
   */
  useEffect(() => {
    const el = ref.current;
    const shell = el && el.closest('.shell');
    if (!el || !shell || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      shell.style.setProperty('--topbar-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header className="topbar" ref={ref}>
      <Link href="/trips" className="brand-link" data-tip="All your trips"
        aria-label="Wander — all trips">
        <span className="brand-mark" aria-hidden="true"><Plane size={16} /></span>
        <span className="brand-word">Wander</span>
      </Link>

      {children}

      <div className="grow" />

      {tools}

      <Presence online={online} meId={user ? user.id : null} />

      <button ref={menuBtn} className="btn ghost sm who" type="button"
        data-tip="Account, appearance and sign out"
        aria-haspopup="menu" aria-expanded={open} aria-label={`Account — ${who}`}
        onClick={() => setOpen((o) => !o)}>
        <span className="who-mark" aria-hidden="true">{initials(who)}</span>
        <span className="who-full">{who}</span>
        <ChevronDown size={14} className="who-chev" aria-hidden="true" />
      </button>

      {/* Always rendered, so closing it can be a transition (see Popover). */}
      <Popover anchorEl={menuBtn.current} open={open} width={228}
        onClose={() => setOpen(false)}>
        <div className="act-menu" role="menu">
          <p className="menu-who">
            {who}
            {user && user.email ? <span className="menu-who-sub">{user.email}</span> : null}
          </p>

          {menu.map((m) => {
            const Icon = m.icon;
            return m.href ? (
              <Link key={m.id} href={m.href} role="menuitem" onClick={() => setOpen(false)}>
                <Icon size={15} /> {m.label}
              </Link>
            ) : (
              <button key={m.id} type="button" role="menuitem"
                onClick={() => { setOpen(false); m.onClick(); }}>
                <Icon size={15} /> {m.label}
              </button>
            );
          })}

          {menu.length ? <div className="menu-rule" /> : null}

          {/* Left open on purpose: cycling through system, light and dark is
              worth watching happen, and closing after each press would make
              three taps out of what should be one. */}
          <button type="button" role="menuitem" onClick={toggle}>
            <ThemeIcon size={15} /> Appearance
            <span className="menu-tail">{themeWord}</span>
          </button>

          <button type="button" role="menuitem"
            onClick={() => { setOpen(false); signOut(); }}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </Popover>
    </header>
  );
}
