'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, MapPin, Navigation, Clock, ChevronRight, CalendarDays,
} from 'lucide-react';
import { useTrip } from '@/components/TripProvider';
import { activityIcon } from '@/lib/icons';
import { transportLine } from '@/lib/transport';
import {
  categoryOf, fmtDayTiny, fmtTime, money, shortPlace, sortActs, todayISO,
} from '@/lib/util';

/**
 * The trip, while you are on it.
 *
 * A plan and a day are different documents. Planning wants the whole fortnight
 * at once — every day, every cost, every alternative. Standing on a street
 * corner with a bag and one bar of signal, all of that is in the way of the
 * only two things that matter: what you are meant to be doing now, and what
 * comes after it.
 *
 * So this is not a smaller itinerary. It is two cards and a clock, it only
 * exists while the trip is actually running, and everything on it is something
 * you can act on where you are standing — walk there, ring them, or see the
 * rest.
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

/** "in 25 min", "in 2h 10m", "now" — how long until something starts. */
function until(mins) {
  if (mins == null) return '';
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/**
 * Where the day has got to.
 *
 * "Now" is whatever has started and not finished, or failing that whatever
 * started most recently — because an activity with no end time does not stop
 * being where you are just because the plan forgot to say when it ends.
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

function Card({ act, currency, lead, minsAway }) {
  if (!act) return null;
  const cat = categoryOf(act.category);
  const Icon = activityIcon(act);
  const place = shortPlace(act.location);
  const leg = act.category === 'transport' ? transportLine(act.subtype, act.details) : '';
  const maps = act.lat != null && act.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${act.lat},${act.lng}`
    : place || act.location
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(act.location)}`
      : '';

  return (
    <section className={`tcard tcard-${lead === 'Now' ? 'now' : 'next'}`}>
      <div className="tcard-lead">
        <span className={`catico cat-${cat.id}`} aria-hidden="true"><Icon size={15} /></span>
        <span className="tcard-when">{lead}</span>
        {act.start_time ? (
          <span className="tcard-time mono">{fmtTime(act.start_time)}</span>
        ) : null}
        {minsAway != null && minsAway > 0 ? (
          <span className="tcard-in"><Clock size={12} /> {until(minsAway)}</span>
        ) : null}
      </div>

      <h2 className="tcard-title">{act.title}</h2>

      {leg ? <p className="tcard-leg mono">{leg}</p> : null}
      {place ? <p className="tcard-place"><MapPin size={13} /> {place}</p> : null}
      {act.booking_ref ? <p className="tcard-ref mono">{act.booking_ref}</p> : null}
      {Number(act.cost) > 0 ? (
        <p className="tcard-cost mono">{money(act.cost, currency)}</p>
      ) : null}
      {act.notes ? <p className="tcard-notes">{act.notes}</p> : null}

      {maps ? (
        <a className="btn primary tcard-go" href={maps} target="_blank" rel="noreferrer">
          <Navigation size={15} /> Take me there
        </a>
      ) : null}
    </section>
  );
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
  // Out of the trip's range, "today" is meaningless — fall back to the first
  // day, so the screen is a preview rather than an error.
  const day = days.includes(today) ? today : days[0];
  const list = activities.filter((a) => a.day === day).slice().sort(sortActs);
  const { now, next } = readDay(list, at);
  const dayNo = days.indexOf(day) + 1;
  const away = next ? (toMinutes(next.start_time) || 0) - at : null;

  return createPortal((
    <div className="tourist">
      <header className="tourist-top">
        <span className="tourist-day">
          <CalendarDays size={14} aria-hidden="true" />
          Day {dayNo} of {days.length}
          {day !== today ? ` · ${fmtDayTiny(day)}` : ''}
        </span>
        <span className="tourist-clock mono">{fmtTime(
          `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`,
        )}</span>
        <button className="btn ghost sm icon-btn" type="button"
          data-tip="Back to the plan  Esc" aria-label="Close tourist mode"
          onClick={onClose}><X size={16} /></button>
      </header>

      <div className="tourist-body">
        {!list.length ? (
          <p className="tourist-empty">Nothing planned for today. Enjoy it.</p>
        ) : (
          <>
            <Card act={now} currency={trip.currency} lead="Now" />
            <Card act={next} currency={trip.currency} lead="Next" minsAway={away} />
            {!now && !next ? (
              <p className="tourist-empty">That is everything for today.</p>
            ) : null}
          </>
        )}
      </div>

      <footer className="tourist-foot">
        <button className="btn" type="button" onClick={onClose}>
          The whole plan <ChevronRight size={15} />
        </button>
      </footer>
    </div>
  ), document.body);
}

/** Only worth offering once the trip has actually begun. */
export function tripIsOn(trip) {
  if (!trip || !trip.start_date) return false;
  const today = todayISO();
  return today >= trip.start_date && today <= (trip.end_date || trip.start_date);
}
