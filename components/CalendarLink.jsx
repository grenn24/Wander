'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock, Loader2, Check, Link2Off, TriangleAlert,
} from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import {
  calendarStatus, dropCalendar, pushTrip,
} from '@/lib/gcal';

/**
 * The Google Calendar connection, and what it is for.
 *
 * Both directions live here because they are one decision. Reading tells the
 * planner what is already in the way; writing puts the trip where the rest of
 * someone's life already is. Asking twice, on two screens, for what is really
 * one grant of permission would be worse than asking plainly once.
 *
 * The consent is deliberately not folded into signing in. Reading somebody's
 * diary is not the price of entry to a trip planner, and it says here, in
 * words, exactly what it will do with what it reads.
 */
export default function CalendarLink({ trip }) {
  const { supabase, connectCalendar, pushToast, fail } = useApp();
  const [state, setState] = useState(null); // null while unknown
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const look = useCallback(async () => {
    if (!supabase) return;
    try {
      setState(await calendarStatus(supabase));
    } catch (e) {
      setState({ available: false, connected: false });
    }
  }, [supabase]);

  useEffect(() => { look(); }, [look]);

  async function connect() {
    setErr(''); setBusy('connect');
    try {
      // Leaves the page for Google and comes back to it, so nothing after this
      // line runs on the way out.
      await connectCalendar();
    } catch (e) {
      setErr(e.message || 'Could not start the connection.');
      setBusy('');
    }
  }

  async function disconnect() {
    setErr(''); setBusy('drop');
    try {
      await dropCalendar(supabase);
      await look();
      pushToast('Google Calendar disconnected.');
    } catch (e) {
      setErr(e.message || 'Could not disconnect.');
    } finally { setBusy(''); }
  }

  async function push() {
    setErr(''); setBusy('push');
    try {
      const out = await pushTrip(supabase, trip.id);
      const total = out.written + out.updated;
      if (!total) pushToast('Nothing to add yet — the trip has no activities.');
      else {
        pushToast(`${total} event${total === 1 ? '' : 's'} in your calendar`
          + `${out.updated ? ` (${out.updated} updated)` : ''}.`);
      }
      if (out.failed && out.failed.length) {
        setErr(`Could not write: ${out.failed.join(', ')}.`);
      }
    } catch (e) {
      if (e.code === 'reconnect') { setErr(e.message); await look(); } else {
        setErr(e.message || 'Could not write to your calendar.');
        fail(e);
      }
    } finally { setBusy(''); }
  }

  if (state && !state.available) {
    return (
      <section className="card tset">
        <h3 className="tset-h"><CalendarClock size={15} aria-hidden="true" /> Google Calendar</h3>
        <p className="tset-hint">
          Not set up on this deployment. It needs Google OAuth credentials and a Supabase
          service role key on the server.
        </p>
      </section>
    );
  }

  const zone = typeof Intl !== 'undefined'
    ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') : 'UTC';

  return (
    <section className="card tset">
      <h3 className="tset-h"><CalendarClock size={15} aria-hidden="true" /> Google Calendar</h3>

      {state === null ? (
        <p className="tset-hint"><Loader2 size={13} className="spin" /> Checking…</p>
      ) : state.connected ? (
        <>
          <p className="tset-hint">
            Connected. Wander can see what is already in your calendar on the trip&rsquo;s dates,
            and can write the trip back into it.
          </p>
          <div className="chiprow">
            <button className="btn primary" type="button" disabled={!!busy} onClick={push}>
              {busy === 'push' ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
              {' '}Add this trip to my calendar
            </button>
            <button className="btn" type="button" disabled={!!busy} onClick={disconnect}>
              {busy === 'drop' ? <Loader2 size={15} className="spin" /> : <Link2Off size={15} />}
              {' '}Disconnect
            </button>
          </div>
          {/* Said out loud rather than discovered later: an activity holds a
              date and a wall-clock time and no zone, so this is the one being
              assumed. */}
          <p className="tiny dim" style={{ marginTop: 10, marginBottom: 0 }}>
            Times are written in {zone}. Syncing again updates the same events rather
            than adding them twice.
          </p>
        </>
      ) : (
        <>
          <p className="tset-hint">
            Connect it and Wander will show what you already have booked on these dates,
            plan around it, and add the trip to your calendar when you ask.
          </p>
          <p className="tiny dim" style={{ marginTop: -4 }}>
            Only events between the trip&rsquo;s start and end dates are ever read, and only
            when you are looking at the trip. When you ask it to plan around them, those
            events are sent to the planner along with the rest of the trip. You can
            disconnect here at any time, which also revokes the permission at Google.
          </p>
          <button className="btn primary" type="button" disabled={!!busy} onClick={connect}>
            {busy === 'connect' ? <Loader2 size={15} className="spin" />
              : <CalendarClock size={15} />}
            {' '}Connect Google Calendar
          </button>
        </>
      )}

      {err ? (
        <p className="err" style={{ marginTop: 12 }}>
          <TriangleAlert size={14} /> {err}
        </p>
      ) : null}
    </section>
  );
}
