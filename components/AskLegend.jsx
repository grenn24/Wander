'use client';
import { MapPin, MapPinOff } from 'lucide-react';
import { categoryIcon } from '@/lib/icons';
import s from './TripAsk.module.css';

/**
 * The list under an answer's map, and beside it full size: every place in
 * the answer's order, a stop with its number in its day's colour, anything
 * else with a glyph for what it is.
 *
 * rows: [{ key, kind: 'stop' | 'place', title, meta, label, colour, category,
 *          target }] — `target` is the place to open, null for one that was
 * not found.
 */
export default function AskLegend({ rows, onPick, current }) {
  return (
    <ol className={s.legend}>
      {rows.map((r) => {
        // A plain pin until the lookup says what kind of place it is.
        const Icon = r.kind !== 'place' ? null : r.category ? categoryIcon(r.category) : MapPin;
        return (
          <li key={r.key}>
            <button type="button" className={s.legendRow} disabled={!r.target}
              aria-current={current === r.key ? 'true' : undefined}
              onClick={r.target ? () => onPick(r) : undefined}>
              {r.kind === 'stop' ? (
                r.label ? <span className={s.pin} style={{ '--pin': r.colour }}>{r.label}</span>
                  : <span className={s.pinPlace}><MapPinOff size={13} aria-hidden="true" /></span>
              ) : (
                <span className={s.pinPlace}><Icon size={13} aria-hidden="true" /></span>
              )}
              <span className={s.legendText}>
                <span className={s.legendName}>{r.title}</span>
                <span className="small muted">{r.meta}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
