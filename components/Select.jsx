'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * A select that follows the app's material instead of the platform's.
 *
 * Keeps the keyboard behaviour people expect from the native control: arrows
 * and Home/End move, Enter or Space commits, Escape cancels back to the value
 * you started with, and typing jumps to a matching option.
 *
 * options: [{ value, label, hint?, icon? }]
 */
export default function Select({
  value, onChange, options, label, id, disabled = false, align = 'start', className = '',
}) {
  const auto = useId();
  const listId = `${id || auto}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [flip, setFlip] = useState(false);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const typed = useRef({ str: '', at: 0 });

  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[index] || options[0];

  const close = useCallback((restore) => {
    setOpen(false);
    if (restore != null) onChange(restore);
    const btn = rootRef.current && rootRef.current.querySelector('button');
    if (btn) btn.focus();
  }, [onChange]);

  // Outside click and scroll dismiss, matching the native control.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Open upwards when there is not room below.
  useEffect(() => {
    if (!open || !rootRef.current) return;
    const box = rootRef.current.getBoundingClientRect();
    setFlip(window.innerHeight - box.bottom < Math.min(280, options.length * 38 + 16));
    setActive(index);
  }, [open, index, options.length]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function commit(i) {
    const opt = options[i];
    if (!opt) return;
    onChange(opt.value);
    close();
  }

  function onKeyDown(e) {
    if (disabled) return;

    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(active); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); return; }

    // Type-ahead: consecutive letters build a prefix, a pause starts over.
    if (e.key.length === 1) {
      const now = Date.now();
      typed.current.str = now - typed.current.at > 700 ? e.key : typed.current.str + e.key;
      typed.current.at = now;
      const hit = options.findIndex(
        (o) => o.label.toLowerCase().startsWith(typed.current.str.toLowerCase()),
      );
      if (hit >= 0) setActive(hit);
    }
  }

  return (
    <div className={`sel${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="sel-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        {current && current.icon ? <span className="sel-ico">{current.icon}</span> : null}
        <span className="sel-value">{current ? current.label : ''}</span>
        <ChevronDown size={15} className="sel-chev" aria-hidden="true" />
      </button>

      {open ? (
        <ul
          className={`sel-list${flip ? ' flip' : ''}${align === 'end' ? ' end' : ''}`}
          id={listId}
          role="listbox"
          ref={listRef}
          tabIndex={-1}
          aria-activedescendant={`${listId}-${active}`}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`sel-opt${i === active ? ' is-active' : ''}${o.value === value ? ' is-chosen' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); commit(i); }}
            >
              {o.icon ? <span className="sel-ico">{o.icon}</span> : null}
              <span className="sel-opt-label">
                {o.label}
                {o.hint ? <span className="sel-hint">{o.hint}</span> : null}
              </span>
              {o.value === value ? <Check size={14} className="sel-check" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
