import Link from 'next/link';
import { LayoutGrid, Earth, BookOpen } from 'lucide-react';
import s from './HomeNav.module.css';

const ITEMS = [
  { id: 'trips', href: '/trips', label: 'Trips', icon: LayoutGrid },
  { id: 'globe', href: '/globe', label: 'Globe', icon: Earth },
  { id: 'journeys', href: '/journeys', label: 'Journeys', icon: BookOpen },
];

/**
 * The three places that are about you rather than one trip: what you have
 * planned, where you have been, and where you might go. Shown on those pages
 * only — inside a trip the bar belongs to the trip.
 */
export default function HomeNav({ active }) {
  return (
    <nav className={s.nav} aria-label="Sections">
      {ITEMS.map(({ id, href, label, icon: Icon }) => (
        <Link key={id} href={href} className={s.item}
          aria-current={active === id ? 'page' : undefined}>
          <Icon size={15} aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
