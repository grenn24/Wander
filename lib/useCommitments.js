'use client';
import { useEffect, useState } from 'react';
import { calendarEvents } from '@/lib/gcal';

/**
 * What is already in your calendar on the trip's dates, keyed by day.
 *
 * Fetched once per trip, and only for the days the trip covers — a travel
 * planner has no business holding a year of anybody's diary.
 *
 * The "not connected" answer is remembered for the tab. Almost nobody has a
 * calendar connected, and without this every trip anyone opened would start
 * with a pointless round trip to be told so again.
 */
let connected = null; // null unknown | false no | true yes

/** Called after connecting, so the next trip actually asks again. */
export function calendarMayHaveChanged() {
  connected = null;
}

export default function useCommitments(supabase, trip) {
  const [byDay, setByDay] = useState({});
  const id = trip && trip.id;
  const from = trip && trip.start_date;
  const to = trip && trip.end_date;

  useEffect(() => {
    if (connected === false || !supabase || !id || !from || !to) return undefined;
    let alive = true;

    (async () => {
      try {
        const { events } = await calendarEvents(supabase, from, to);
        if (!alive) return;
        connected = true;
        const map = {};
        (events || []).forEach((e) => {
          const day = String(e.start).slice(0, 10);
          if (!map[day]) map[day] = [];
          map[day].push(e);
        });
        setByDay(map);
      } catch (e) {
        if (!alive) return;
        /*
         * 409 means no calendar is connected and 401 means nobody is signed
         * in: both are settled answers worth remembering. Anything else is a
         * bad moment — a dropped connection, Google having a wobble — and the
         * next trip should try again rather than assume the worst for the rest
         * of the session.
         */
        if (e.code === 'reconnect' || e.status === 401) connected = false;
        setByDay({});
      }
    })();

    return () => { alive = false; };
  }, [supabase, id, from, to]);

  return byDay;
}
