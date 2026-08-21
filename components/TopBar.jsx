'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Plane, Sun, Moon, SunMoon, Menu } from 'lucide-react';
import { useApp, useTheme } from '@/components/AppProvider';
import Popover from '@/components/Popover';
import { colorFor, initials } from '@/lib/util';

/**
 * Global chrome. `children` slots into the middle for page-specific context
 * (a trip name, a breadcrumb); presence avatars are passed in only where they
 * mean something, which is inside a trip.
 *
 * On phones this collapses to the platform convention — back, title, and two
 * icon actions — because a row of words at 375px is a queue, not a toolbar.
 *
 * `menu` takes [{ id, label, icon, href | onClick }] and turns the trailing
 * control into an overflow menu. Pages that pass nothing keep the plain
 * identity chip.
 */
export default function TopBar({ children, online = [], menu = null, onOpenProfile }) {
  const { displayName } = useApp();
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === 'dark' ? Sun : theme === 'light' ? Moon : SunMoon;
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

  const badge = (
    <>
      <span className="who-full">{who}</span>
      <span className="who-short" aria-hidden="true">{initials(who)}</span>
    </>
  );

  return (
    <header className="topbar" ref={ref}>
      <Link href="/trips" className="brand-link" aria-label="Wander — all trips">
        <span className="brand-mark" aria-hidden="true"><Plane size={16} /></span>
        <span className="brand-word">Wander</span>
      </Link>

      {children}

      <div className="grow" />

      {online.length > 0 ? (
        <span className="live" title={online.map((o) => o.name).join(', ')}>
          <span className="pulse" /> {online.length} here
        </span>
      ) : null}
      {online.length > 0 ? (
        <div className="avatars">
          {online.slice(0, 4).map((o) => (
            <span key={o.id} className="avatar" title={o.name}
              style={{ background: colorFor(o.name) }}>{initials(o.name)}</span>
          ))}
        </div>
      ) : null}

      <button className="btn ghost sm icon-btn" onClick={toggle}
        title="Switch light / dark" aria-label="Switch light or dark theme">
        <ThemeIcon size={16} />
      </button>

      {menu ? (
        <>
          <button ref={menuBtn} className="btn ghost sm icon-btn" type="button"
            title="Menu" aria-label="Trip menu" aria-haspopup="menu" aria-expanded={open}
            onClick={() => setOpen((o) => !o)}>
            <Menu size={17} />
          </button>
          {open ? (
            <Popover anchorEl={menuBtn.current} open width={208}
              onClose={() => setOpen(false)}>
              <div className="act-menu" role="menu">
                {/* The name used to sit in the bar itself; it still belongs
                    somewhere, and this is where the account actions are now. */}
                <p className="menu-who">{who}</p>
                {menu.map((m) => {
                  const Icon = m.icon;
                  return m.href ? (
                    <Link key={m.id} href={m.href} role="menuitem"
                      onClick={() => setOpen(false)}>
                      <Icon size={15} /> {m.label}
                    </Link>
                  ) : (
                    <button key={m.id} type="button" role="menuitem"
                      onClick={() => { setOpen(false); m.onClick(); }}>
                      <Icon size={15} /> {m.label}
                    </button>
                  );
                })}
              </div>
            </Popover>
          ) : null}
        </>
      ) : onOpenProfile ? (
        <button className="btn ghost sm who" title="You" aria-label={`You — ${who}`}
          onClick={onOpenProfile}>
          {badge}
        </button>
      ) : (
        <span className="btn ghost sm who" style={{ cursor: 'default' }} title={who}>
          {badge}
        </span>
      )}
    </header>
  );
}
