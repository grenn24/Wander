'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Plane, Sun, Moon, SunMoon } from 'lucide-react';
import { useApp, useTheme } from '@/components/AppProvider';
import { colorFor, initials } from '@/lib/util';

/**
 * Global chrome. `children` slots into the middle for page-specific context
 * (a trip name, a breadcrumb); presence avatars are passed in only where they
 * mean something, which is inside a trip.
 *
 * On phones this collapses to the platform convention — back, title, and two
 * icon actions — because a row of words at 375px is a queue, not a toolbar.
 */
export default function TopBar({ children, online = [], onOpenProfile }) {
  const { displayName } = useApp();
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === 'dark' ? Sun : theme === 'light' ? Moon : SunMoon;
  const ref = useRef(null);
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

      {onOpenProfile ? (
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
