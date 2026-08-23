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
 * An activity with an end time is over when that time passes. One without an
 * end time runs until the next thing starts, and if it is the last thing of
 * the day, until the day is out — because the plan forgetting to say when
 * dinner ends does not mean dinner ends immediately, and does not mean it is
 * still going at eleven the next morning either.
 *
 * That second half matters: the old rule fell back to "whatever started most
 * recently", which had no way of ever running out, so a six o'clock train sat
 * there being Now until midnight and the day could never be finished.
 */
function readDay(list, at) {
  const timed = list
    .filter((a) => toMinutes(a.start_time) != null)
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

  let now = null;
  let next = null;

  timed.forEach((a, i) => {
    const from = toMinutes(a.start_time);
    const after = timed[i + 1] ? toMinutes(timed[i + 1].start_time) : 24 * 60;
    const to = toMinutes(a.end_time) ?? after;
    if (from <= at && to > at) now = a;
    else if (from > at && !next) next = a;
  });

  // Nothing has a time on it, so the first thing on the list is the plan.
  if (!now && !next && !timed.length) next = list[0] || null;
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

  /*
   * The middle of the screen is whatever is closest to hand: what you are
   * doing, or failing that what you are about to. Between two activities the
   * honest answer is the one coming, not a claim that the day is over.
   */
  const lead = now || next;
  const onIt = !!now;
  const after = now ? next : null;
  const Icon = lead ? activityIcon(lead) : Ticket;
  const place = lead ? shortPlace(lead.location) : '';
  const leg = lead && lead.category === 'transport'
    ? transportLine(lead.subtype, lead.details) : '';
  const leadAway = !onIt && live && lead ? (toMinutes(lead.start_time) ?? 0) - at : null;
  const leadTo = onIt ? '' : directions(lead);
  const afterTo = directions(after);

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
        {lead ? (
          <>
            <span className="today-mark" aria-hidden="true"><Icon size={26} /></span>
            <p className="today-label">
              {onIt ? 'Now' : 'Up next'}
              {leadAway != null && leadAway > 0 ? ` · ${until(leadAway)}` : ''}
            </p>
            <h1 className="today-title">{lead.title}</h1>
            <p className="today-at mono">
              {lead.start_time ? fmtTime(lead.start_time) : ''}
              {lead.end_time ? ` – ${fmtTime(lead.end_time)}` : ''}
            </p>
            {leg ? <p className="today-leg mono">{leg}</p> : null}
            {place ? <p className="today-place"><MapPin size={14} /> {place}</p> : null}
            {lead.booking_ref ? <p className="today-ref mono">{lead.booking_ref}</p> : null}
            {Number(lead.cost) > 0 ? (
              <p className="today-cost mono">{money(lead.cost, trip.currency)}</p>
            ) : null}
            {lead.notes ? <p className="today-notes">{lead.notes}</p> : null}
            {/* Directions only where you have not arrived yet. */}
            {leadTo ? (
              <a className="btn primary today-go" href={leadTo} target="_blank" rel="noreferrer">
                <Navigation size={15} /> Take me there
              </a>
            ) : null}
          </>
        ) : (
          <p className="today-free">
            {list.length ? 'The day is yours from here.' : 'Nothing planned. Enjoy it.'}
          </p>
        )}
      </main>

      {/*
        * Next is a line, not a card. It is not a decision until this one ends —
        * but when it is, the way there should already be under your thumb.
        */}
      {after ? (
        <footer className="today-next">
          <div className="today-next-what">
            <span className="today-next-label">
              Next{away != null && away > 0 ? ` · ${until(away)}` : ''}
            </span>
            <span className="today-next-title">
              {after.start_time ? <b className="mono">{fmtTime(after.start_time)}</b> : null}
              {after.title}
            </span>
          </div>
          {afterTo ? (
            <a className="btn sm today-next-go" href={afterTo} target="_blank" rel="noreferrer">
              <Navigation size={14} /> <span>Directions</span>
            </a>
          ) : null}
        </footer>
      ) : null}
    </div>
  ), document.body);
}
