'use client';
import { Heart } from 'lucide-react';
import s from './FavouriteButton.module.css';

/**
 * The heart that favourites a trip or a journey.
 *
 * `compact` is the icon alone, for a card that is itself a link — it stops the
 * click there so favouriting a trip does not also open it. Otherwise it is a
 * button with its words, for a panel with room for them.
 */
export default function FavouriteButton({ on, name, onToggle, busy = false, compact = false }) {
  const label = on ? `Remove ${name} from favourites` : `Add ${name} to favourites`;
  return (
    <button type="button" aria-pressed={on} disabled={busy}
      className={compact ? s.compact : `btn ${s.full}`}
      aria-label={compact ? label : undefined}
      data-tip={compact ? (on ? 'Favourited' : 'Favourite') : undefined}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(!on); }}>
      <Heart size={compact ? 16 : 15} aria-hidden="true" className={s.heart} />
      {compact ? null : on ? 'Favourited' : 'Favourite'}
    </button>
  );
}
