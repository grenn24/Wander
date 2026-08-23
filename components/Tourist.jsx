'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, MapPin, Navigation, CalendarDays, Ticket,
} from 'lucide-react';
import { useTrip } from '@/components/TripProvider';
import { activityIcon } from '@/lib/icons';
import { transportLine } from '@/lib/transport';
import {
  fmtDayTiny, fmtTime, money, shortPlace, sortActs, todayISO,
} from '@/lib/util';

/**
 * The trip, while you are on it.
 *
 * A plan and a day are different documents. Planning wants the whole fortnight
 * at once — every day, every cost, every alternative. Standing somewhere with a
 * bag and one bar of signal, all of that is in the way of the only two things
 * that matter: what you are doing, and what comes after it.
 *
 * So there are no cards. What you are doing now is simply the screen — set in
 * the middle, in the largest type in the app, readable at arm's length in
 * daylight. What comes next is one line along the bottom, because it is not a
 * decision yet; it is the thing you will want the moment this one ends, and
 * that is the only moment it needs a button.
 *
 * Nothing here offers to take you to where you already are.
 */

/** Minutes since midnight, from the clock rather than from the plan. */
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function toMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

/** "in 25 min", "in 2h 10m" — how long until something starts. */
function until(mins) {
  if (mins == null || mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/**
 * Where the day has got to.
 *
 * "Now" is whatever has started and not finished, or failing that whatever
 * started most recently — an activity with no end time does not stop being
 * where you are because the plan forgot to say when it ends.
 */
function readDay(list, at) {
  const timed = list.filter((a) => toMinutes(a.start_time) != null);
  let now = null;
  let next = null;

  timed.forEach((a) => {
    const from = toMinutes(a.start_time);
    const to = toMinutes(a.end_time);
    if (from <= at && (to == null || to > at)) now = a;
    else if (from > at && (!next || from < toMinutes(next.start_time))) next = a;
  });

  if (!now) {
    const started = timed.filter((a) => toMinutes(a.start_time) <= at);
    now = started.length ? started[started.length - 1] : null;
  }
  // Nothing has a time on it, so the first thing on the list is the plan.
  if (!now && !next) next = list[0] || null;
  return { now, next };
}

/** Where a place is, handed to whatever the phone uses for directions. */
function directions(act) {
  if (!act) return '';
  if (act.lat != null && act.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${act.lat},${act.lng}`;
  }
  return act.location
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(act.location)}`
    : '';
}

export default function Tourist({ onClose }) {
  const { trip, days, activities } = useTrip();
  const [at, setAt] = useState(nowMinutes);
  const [ready, setReady] = useState(false);

  useEffect(() => { setReady(true); }, []);

  // The clock is the only thing on this screen that changes by itself.
  useEffect(() => {
    const t = setInterval(() => setAt(nowMinutes()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (!ready || !trip) return null;

  const today = todayISO();
  /*
   * Away from the trip's dates there is no "now", so the screen shows day one
   * and says so — a preview rather than an error, and the reason this is
   * reachable before anyone has left home.
   */
  const live = days.includes(today);
  const day = live ? today : days[0];
  const list = activities.filter((a) => a.day === day).slice().sort(sortActs);
  const { now, next } = readDay(list, live ? at : -1);
  const dayNo = days.indexOf(day) + 1;
  const away = next ? (toMinutes(next.start_time) ?? 0) - at : null;

  const Icon = now ? activityIcon(now) : Ticket;
  const place = now ? shortPlace(now.location) : '';
  const leg = now && now.category === 'transport'
    ? transportLine(now.subtype, now.details) : '';
  const nextTo = directions(next);

  return createPortal((
    <div className="today">
      <header className="today-top">
        <span className="today-day">
          <CalendarDays size={14} aria-hidden="true" />
          Day {dayNo} of {days.length}
          {live ? '' : ` · ${fmtDayTiny(day)}`}
        </span>
        <span className="today-clock mono">
          {live ? fmtTime(`${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`)
            : 'Not started'}
        </span>
        <button className="btn ghost sm icon-btn" type="button"
          data-tip="Close  Esc" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </header>

      <main className="today-now">
        {now ? (
          <>
            <span className="today-mark" aria-hidden="true"><Icon size={26} /></span>
            <p className="today-label">{live ? 'Now' : 'Starting the day'}</p>
            <h1 className="today-title">{now.title}</h1>
            <p className="today-at mono">
              {now.start_time ? fmtTime(now.start_time) : ''}
              {now.end_time ? ` – ${fmtTime(now.end_time)}` : ''}
            </p>
            {leg ? <p className="today-leg mono">{leg}</p> : null}
            {place ? <p className="today-place"><MapPin size={14} /> {place}</p> : null}
            {now.booking_ref ? <p className="today-ref mono">{now.booking_ref}</p> : null}
            {Number(now.cost) > 0 ? (
              <p className="today-cost mono">{money(now.cost, trip.currency)}</p>
            ) : null}
            {now.notes ? <p className="today-notes">{now.notes}</p> : null}
          </>
        ) : (
          <p className="today-free">
            {list.length ? 'That is everything for today.' : 'Nothing planned. Enjoy it.'}
          </p>
        )}
      </main>

      {/*
        * Next is a line, not a card. It is not a decision until this one ends —
        * but when it is, the way there should already be under your thumb.
        */}
      {next ? (
        <footer className="today-next">
          <div className="today-next-what">
            <span className="today-next-label">
              Next{away != null && away > 0 ? ` · ${until(away)}` : ''}
            </span>
            <span className="today-next-title">
              {next.start_time ? <b className="mono">{fmtTime(next.start_time)}</b> : null}
              {next.title}
            </span>
          </div>
          {nextTo ? (
            <a className="btn sm today-next-go" href={nextTo} target="_blank" rel="noreferrer">
              <Navigation size={14} /> <span>Directions</span>
            </a>
          ) : null}
        </footer>
      ) : null}
    </div>
  ), document.body);
}
