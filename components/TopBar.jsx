'use client';
import Link from 'next/link';
import { Plane, Sun, Moon, SunMoon } from 'lucide-react';
import { useApp, useTheme } from '@/components/AppProvider';
import { colorFor, initials } from '@/lib/util';

/**
 * Global chrome. `children` slots into the middle for page-specific context
 * (a trip name, a breadcrumb); presence avatars are passed in only where they
 * mean something, which is inside a trip.
 */
export default function TopBar({ children, online = [], onOpenProfile }) {
  const { displayName } = useApp();
  const { theme, toggle } = useTheme();
  const ThemeIcon = theme === 'dark' ? Sun : theme === 'light' ? Moon : SunMoon;

  return (
    <header className="topbar">
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
        <button className="btn ghost sm" title="You" onClick={onOpenProfile}>
          {displayName || 'Guest'}
        </button>
      ) : (
        <span className="btn ghost sm" style={{ cursor: 'default' }}>{displayName || 'Guest'}</span>
      )}
    </header>
  );
}
