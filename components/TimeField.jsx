'use client';
import { useEffect, useRef, useState } from 'react';
import { Clock, X } from 'lucide-react';
import Popover from '@/components/Popover';
import { fmtTime } from '@/lib/util';

/**
 * A time, in this app's material rather than the platform's.
 *
 * <input type="time"> hands the job to the browser, and the browser answers
 * with three scrolling columns in its own colours, its own font and its own
 * idea of dark — the one control in the editor that looked like it came from
 * somewhere else. There is no styling it: the dropdown is browser chrome.
 *
 * So: a normal text box that takes what anyone would type — 9, 930, 9:30,
 * 9:30pm, 21:30 — and a list of the times people actually pick. Typing is
 * faster than any picker for a time you already know; the list is faster for
 * one you are choosing. Neither is made to wait for the other.
 */

/* Every quarter hour. Long enough to cover what people plan around, short
   enough to scroll; anything in between is typed. */
const STEPS = (() => {
  const out = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
})();

/**
 * What someone meant by what they typed.
 *
 * Deliberately forgiving: a time is the one field in this editor people type
 * at speed and in whatever shape is in their head. Anything unreadable returns
 * null and simply leaves the value alone rather than guessing.
 */
export function parseTime(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return '';

  const pm = /p/.test(s);
  const am = /a/.test(s);
  const digits = s.replace(/[^\d:]/g, '');
  if (!digits) return null;

  let h;
  let m = 0;
  if (digits.includes(':')) {
    const [a, b] = digits.split(':');
    h = Number(a);
    m = Number(b || 0);
  } else if (digits.length <= 2) {
    h = Number(digits);
  } else {
    // 930 -> 9:30, 1045 -> 10:45
    h = Number(digits.slice(0, digits.length - 2));
    m = Number(digits.slice(-2));
  }

  if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59) return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function TimeField({ id, value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const btn = useRef(null);
  const wrap = useRef(null);
  const listRef = useRef(null);

  // The box shows the tidy version until someone starts editing it.
  useEffect(() => { setText(value ? fmtTime(value) : ''); }, [value]);

  // Open on the value, not at midnight.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const at = STEPS.indexOf(value) >= 0
      ? STEPS.indexOf(value)
      : STEPS.findIndex((t) => t >= (value || '09:00'));
    const el = listRef.current.children[Math.max(0, at)];
    if (el) el.scrollIntoView({ block: 'center' });
  }, [open, value]);

  function commit(raw) {
    const t = parseTime(raw);
    if (t === null) { setText(value ? fmtTime(value) : ''); return; }
    onChange(t);
  }

  return (
    <div className="tf" ref={wrap}>
      <input
        id={id}
        className="input tf-in"
        value={text}
        inputMode="numeric"
        autoComplete="off"
        placeholder="9:30am"
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(e.target.value); setOpen(false); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); }
          else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
        }}
      />
      {value ? (
        <button ref={btn} className="tf-btn" type="button"
          data-tip="Clear" aria-label={`Clear ${label}`}
          onClick={() => onChange('')}><X size={14} /></button>
      ) : null}
      <button className="tf-btn tf-pick" type="button"
        data-tip="Pick a time" aria-label={`Pick ${label}`} aria-expanded={open}
        ref={value ? undefined : btn}
        onClick={() => setOpen((o) => !o)}><Clock size={15} /></button>

      <Popover anchorEl={wrap.current} open={open} width={132} onClose={() => setOpen(false)}>
        <div className="tf-list" ref={listRef} role="listbox" aria-label={label}>
          {STEPS.map((t) => (
            <button key={t} type="button" role="option" aria-selected={t === value}
              className={`tf-opt${t === value ? ' is-on' : ''}`}
              onClick={() => { onChange(t); setOpen(false); }}>
              {fmtTime(t)}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
