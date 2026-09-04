'use client';
import { useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import Popover from '@/components/Popover';
import Select from '@/components/Select';
import { todayISO } from '@/lib/util';
import { calendarDate, calendarDays, clampDate, dateLabel, offsetDate, offsetMonth } from '@/lib/calendar';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function DateField({ id, label, value = '', onChange, min, max, initialDate, disabled = false }) {
  const autoId = useId();
  const panelId = `${id || autoId}-calendar`;
  const trigger = useRef(null);
  const panel = useRef(null);
  const focusDay = useRef(false);
  const [open, setOpen] = useState(false);
  const today = todayISO();
  const [active, setActive] = useState(value || initialDate || today);
  const [month, setMonth] = useState(active);
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const years = Array.from({ length: 201 }, (_, i) => year - 100 + i);
  const allowed = (day) => (!min || day >= min) && (!max || day <= max);

  function close() {
    setOpen(false);
    focusDay.current = false;
    if (panel.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
  }
  function show() {
    const date = clampDate(value || initialDate || today, min, max);
    setActive(date); setMonth(date); focusDay.current = true; setOpen(true);
  }
  function pick(date) {
    if (date && !allowed(date)) return;
    onChange(date); close();
    trigger.current?.focus({ preventScroll: true });
  }
  function navigate(date, focus = false) {
    const next = clampDate(date, min, max);
    focusDay.current = focus;
    setActive(next); setMonth(next);
  }
  function onDayKey(e) {
    let next;
    if (e.key === 'ArrowLeft') next = offsetDate(active, -1);
    if (e.key === 'ArrowRight') next = offsetDate(active, 1);
    if (e.key === 'ArrowUp') next = offsetDate(active, -7);
    if (e.key === 'ArrowDown') next = offsetDate(active, 7);
    if (e.key === 'Home') next = offsetDate(active, -calendarDate(active).getUTCDay());
    if (e.key === 'End') next = offsetDate(active, 6 - calendarDate(active).getUTCDay());
    if (e.key === 'PageUp') next = offsetMonth(active, e.shiftKey ? -12 : -1);
    if (e.key === 'PageDown') next = offsetMonth(active, e.shiftKey ? 12 : 1);
    if (next) { e.preventDefault(); e.stopPropagation(); navigate(next, true); }
  }

  return <>
    <button ref={trigger} id={id} type="button" disabled={disabled}
      className={`input date-trigger${value ? '' : ' is-empty'}`}
      aria-label={`${label}${value ? `: ${dateLabel(value)}` : ': Choose date'}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => open ? close() : show()}
      onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); show(); } }}>
      <span>{value ? dateLabel(value) : 'Choose date'}</span><CalendarDays size={17} aria-hidden="true" />
    </button>
    <Popover anchorEl={trigger.current} open={open} onClose={close} align="start" width={312} className="pop-date">
      <div ref={panel} id={panelId} role="dialog" aria-label={`Choose ${label}`} className="date-panel"
        inert={!open ? true : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.stopPropagation();
          if (e.key === 'Tab') {
            const items = [...panel.current.querySelectorAll('button:not(:disabled)')]
              .filter((el) => el.tabIndex >= 0);
            const at = items.indexOf(document.activeElement);
            if ((e.shiftKey && at === 0) || (!e.shiftKey && at === items.length - 1)) {
              e.preventDefault(); close();
            }
          }
        }}>
        <div className="date-head">
          <button type="button" className="date-nav" aria-label="Previous month"
            disabled={!!min && month.slice(0, 7) <= min.slice(0, 7)}
            onClick={() => navigate(offsetMonth(month, -1))}><ChevronLeft size={17} /></button>
          <Select label="Month" value={String(monthIndex)}
            options={MONTHS.map((name, i) => ({ value: String(i), label: name }))}
            onChange={(v) => navigate(offsetMonth(month, Number(v) - monthIndex))} />
          <Select label="Year" value={String(year)}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
            onChange={(v) => navigate(offsetMonth(month, (Number(v) - year) * 12))} />
          <button type="button" className="date-nav" aria-label="Next month"
            disabled={!!max && month.slice(0, 7) >= max.slice(0, 7)}
            onClick={() => navigate(offsetMonth(month, 1))}><ChevronRight size={17} /></button>
        </div>
        <span className="sr-only" aria-live="polite">{MONTHS[monthIndex]} {year}</span>
        <table className="date-grid" role="grid" aria-label={`${MONTHS[monthIndex]} ${year}`}>
          <thead><tr>{WEEKDAYS.map((day) => <th scope="col" key={day} abbr={day}>{day.slice(0, 2)}</th>)}</tr></thead>
          <tbody>{Array.from({ length: 6 }, (_, row) => <tr key={row}>
            {calendarDays(month).slice(row * 7, row * 7 + 7).map((day) => <td key={day} aria-selected={day === value}>
              <button type="button" disabled={!allowed(day)} tabIndex={day === active ? 0 : -1}
                ref={(el) => {
                  if (el && day === active && open && focusDay.current) {
                    requestAnimationFrame(() => {
                      if (el.isConnected && focusDay.current) {
                        focusDay.current = false; el.focus({ preventScroll: true });
                      }
                    });
                  }
                }}
                className={`date-day${day === value ? ' selected' : ''}${day === today ? ' today' : ''}${day.slice(0, 7) !== month.slice(0, 7) ? ' other-month' : ''}`}
                aria-label={dateLabel(day, true)} aria-current={day === today ? 'date' : undefined}
                onFocus={() => setActive(day)} onKeyDown={onDayKey} onClick={() => pick(day)}>
                {Number(day.slice(8))}
              </button>
            </td>)}
          </tr>)}</tbody>
        </table>
        <div className="date-foot">
          <button className="btn ghost sm" type="button" disabled={!value} onClick={() => pick('')}>Clear</button>
          <button className="btn ghost sm" type="button" disabled={!allowed(today)} onClick={() => pick(today)}>Today</button>
          <button className="btn ghost sm" type="button" onClick={close}>Close</button>
        </div>
      </div>
    </Popover>
  </>;
}
