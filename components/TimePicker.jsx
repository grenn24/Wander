'use client';
import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { fmtMinute } from '@/lib/util';
import s from './TimePicker.module.css';

/*
 * A time of day, chosen in 12-hour time: a button showing it, opening three
 * short columns — hour, minute, am or pm. The browser's own time input is
 * 24-hour in much of the world and looks different in every browser; this
 * looks like the rest of the app and always reads 10:05am.
 *
 *   value     minutes after midnight, 0 to 1439
 *   onChange  (minutes) as soon as a column changes
 *   label     what the time is for, for screen readers
 */

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const STEP = 5;

export default function TimePicker({ value, onChange, label = 'Time' }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const v = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(v / 60);
  const minute = v % 60;
  const pm = hour24 >= 12;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  // Every five minutes, and the minute it is now if it is not one of those.
  const minutes = [...new Set([...Array.from({ length: 60 / STEP }, (_, i) => i * STEP), minute])].sort((a, b) => a - b);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const set = (h12, m, isPm) => onChange(((h12 % 12) + (isPm ? 12 : 0)) * 60 + m);

  return (
    <span className={s.wrap} ref={box}>
      <button type="button" className={s.button} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${label}: ${fmtMinute(v)}`} onClick={() => setOpen((o) => !o)}>
        <span className={s.value}>{fmtMinute(v)}</span>
        <Clock size={14} aria-hidden="true" />
      </button>
      {open ? (
        <span className={s.pop} role="dialog" aria-label={label}>
          <Column label="Hour" items={HOURS} selected={hour12} show={(h) => String(h)}
            onPick={(h) => set(h, minute, pm)} />
          <Column label="Minute" items={minutes} selected={minute} show={(m) => String(m).padStart(2, '0')}
            onPick={(m) => set(hour12, m, pm)} />
          <Column label="Morning or afternoon" items={['am', 'pm']} selected={pm ? 'pm' : 'am'} show={(x) => x}
            onPick={(x) => set(hour12, minute, x === 'pm')} />
        </span>
      ) : null}
    </span>
  );
}

/* One column: a list to pick from, the arrow keys moving through it. */
function Column({ label, items, selected, show, onPick }) {
  const list = useRef(null);
  useEffect(() => {
    const on = list.current && list.current.querySelector('[aria-selected="true"]');
    if (on) on.scrollIntoView({ block: 'center' });
  }, [selected]);
  const move = (by) => {
    const i = items.indexOf(selected);
    const next = items[Math.max(0, Math.min(items.length - 1, i + by))];
    if (next !== selected) onPick(next);
  };
  return (
    <span className={s.col} role="listbox" aria-label={label} tabIndex={0} ref={list}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      }}>
      {items.map((it) => (
        <span key={it} role="option" aria-selected={it === selected} className={s.opt}
          onClick={() => onPick(it)}>{show(it)}</span>
      ))}
    </span>
  );
}
