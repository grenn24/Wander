'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock, Loader2, Check, Link2Off, TriangleAlert, CalendarX2,
} from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import {
  calendarStatus, dropCalendar, pushTrip, unpushTrip,
} from '@/lib/gcal';

/**
 * The Google Calendar connection, in two halves that belong in two places.
 *
 * Connecting is about your account: one permission, granted once, that has
 * nothing to do with any particular trip and should not be asked for again on
 * the next one. Sending a trip to the calendar is about that trip. They used
 * to sit in one box on the trip's settings tab, which made the permission look
 * like a property of the trip.
 *
 * `mode` picks which half. Both share the status lookup, so neither has to
 * guess what the other has done.
 */
export default function CalendarLink({ mode = 'account', trip = null, synced = false }) {
  const { supabase, connectCalendar, calendar, pushToast, fail } = useApp();
  const [state, setState] = useState(null); // null while unknown
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  // Removing events from somebody's real calendar is not an undo away, so it
  // asks first.
  const [sure, setSure] = useState(false);

  const look = useCallback(async () => {
    if (!supabase) return;
    try {
      setState(await calendarStatus(supabase));
    } catch (e) {
      setState({ available: false, connected: false });
    }
  }, [supabase]);

  /*
   * Asked again the moment the hand-off finishes.
   *
   * On the way back from Google both of these start at once: this panel asks
   * whether a calendar is connected, and the app posts the token that makes it
   * so. `calendar.at` changes when the second one lands, which is the cue to
   * stop believing the answer to the first.
   */
  useEffect(() => { look(); }, [look, calendar.at]);

  async function connect() {
    setErr(''); setBusy('connect');
    try {
      // Leaves for Google and comes back, so nothing after this runs on the
      // way out.
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
      if (!total) pushToast('Nothing to add — this trip has no activities yet.');
      else {
        pushToast(`${total} event${total === 1 ? '' : 's'} in your calendar`
          + `${out.updated ? ` (${out.updated} updated)` : ''}.`);
      }
      if (out.failed && out.failed.length) {
        /* One reason, not five: they are nearly always the same reason, and a
           list of five identical sentences reads as five problems. */
        const why = out.failed[0].why || '';
        const names = out.failed.map((f) => f.title || f).join(', ');
        setErr(`Could not write: ${names}${why ? ` — ${why}` : ''}`);
      }
    } catch (e) {
      if (e.code === 'reconnect') { setErr(e.message); await look(); } else {
        setErr(e.message || 'Could not write to your calendar.');
        fail(e);
      }
    } finally { setBusy(''); }
  }

  async function unpush() {
    setErr(''); setBusy('unpush');
    try {
      const out = await unpushTrip(supabase, trip.id);
      setSure(false);
      pushToast(out.removed
        ? `${out.removed} event${out.removed === 1 ? '' : 's'} removed from your calendar.`
        : 'Nothing of this trip was in your calendar.');
    } catch (e) {
      if (e.code === 'reconnect') { setErr(e.message); await look(); } else {
        setErr(e.message || 'Could not remove those events.');
      }
    } finally { setBusy(''); }
  }

  /* The panel's own failure, or the one that happened on the way back from
     Google before this panel existed to see it. */
  const said = err || (mode === 'account' ? calendar.error : '');
  const problem = said ? (
    <p className="err" style={{ marginTop: 12 }}><TriangleAlert size={14} /> {said}</p>
  ) : null;

  /* ------------------------------------------------------------- a trip --- */
  if (mode === 'trip') {
    // Nothing to offer until the account has a calendar on it, and no reason
    // to advertise the feature from inside a trip.
    if (!state || !state.connected) return null;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    return (
      <section className="card tset">
        <h3 className="tset-h"><CalendarClock size={15} aria-hidden="true" /> Calendar</h3>
        <div className="chiprow">
          <button className="btn primary" type="button" disabled={!!busy} onClick={push}>
            {busy === 'push' ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            {' '}Add this trip to my calendar
          </button>

          {/* Only once there is something there to take out. */}
          {synced && !sure ? (
            <button className="btn" type="button" disabled={!!busy}
              onClick={() => { setErr(''); setSure(true); }}>
              <CalendarX2 size={15} /> Remove from calendar
            </button>
          ) : null}
          {synced && sure ? (
            <>
              <span className="tiny dim">Delete this trip&rsquo;s events?</span>
              <button className="btn danger" type="button" disabled={!!busy} onClick={unpush}>
                {busy === 'unpush' ? <Loader2 size={15} className="spin" />
                  : <CalendarX2 size={15} />}
                {' '}Delete them
              </button>
              <button className="btn ghost" type="button" disabled={!!busy}
                onClick={() => setSure(false)}>Keep them</button>
            </>
          ) : null}
        </div>

        <p className="tiny dim" style={{ margin: '10px 0 0' }}>
          Times in {zone}. Syncing again updates the same events rather than adding more,
          and removing takes out everything this trip put there.
        </p>
        {problem}
      </section>
    );
  }

  /* ---------------------------------------------------------- an account -- */
  return (
    <section className="card tset">
      <h3 className="tset-h"><CalendarClock size={15} aria-hidden="true" /> Google Calendar</h3>

      {calendar.saving ? (
        <p className="tset-hint"><Loader2 size={13} className="spin" /> Finishing the connection…</p>
      ) : state === null ? (
        <p className="tset-hint"><Loader2 size={13} className="spin" /> Checking…</p>
      ) : !state.available ? (
        <p className="tset-hint">Not set up on this deployment.</p>
      ) : state.connected ? (
        <>
          <p className="tset-hint">Connected.</p>
          <button className="btn" type="button" disabled={!!busy} onClick={disconnect}>
            {busy === 'drop' ? <Loader2 size={15} className="spin" /> : <Link2Off size={15} />}
            {' '}Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="tset-hint">
            Wander plans around what you already have on, and can add trips to your calendar.
          </p>
          <button className="btn primary" type="button" disabled={!!busy} onClick={connect}>
            {busy === 'connect' ? <Loader2 size={15} className="spin" />
              : <CalendarClock size={15} />}
            {' '}Connect
          </button>
          {/* One line, because it is the one thing worth knowing before
              agreeing: the scope is a trip's dates, not your diary. */}
          <p className="tiny dim" style={{ margin: '10px 0 0' }}>
            Only a trip&rsquo;s own dates are read, and those events go to the planner when
            you ask it to plan around them. Disconnecting revokes it at Google.
          </p>
        </>
      )}

      {problem}
    </section>
  );
}
