import { userFromRequest, asUser, notSignedIn } from '@/lib/supabaseServer';
import { upsertEvent, NeedsReconnect } from '@/lib/googleCal';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The trip, written into someone's own calendar.
 *
 * The trip is read back out of the database through the caller's own row level
 * security rather than taken from the request, so "sync trip X" cannot be used
 * to read a trip you are not a member of. What the request supplies is a trip
 * id and a timezone, and neither is worth anything on its own.
 */

/** A day plus a wall-clock time, in the shape Google wants. */
function at(day, time, tz) {
  return { dateTime: `${day}T${time}:00`, timeZone: tz };
}

/** Google treats an all-day end as exclusive, so it wants the following day. */
function nextDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** An hour long, unless it says otherwise. */
function plusHour(time) {
  const [h, m] = String(time).split(':').map(Number);
  const total = (h * 60 + (m || 0) + 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function eventFor(a, tz) {
  const timed = !!a.start_time;
  const ends = a.end_time && a.end_time > a.start_time ? a.end_time : plusHour(a.start_time);
  return {
    summary: String(a.title || 'Untitled').slice(0, 300),
    location: a.location ? String(a.location).slice(0, 400) : undefined,
    description: [a.notes, 'Planned in Wander'].filter(Boolean).join('\n\n').slice(0, 2000),
    start: timed ? at(a.day, a.start_time, tz) : { date: a.day },
    end: timed ? at(a.day, ends, tz) : { date: nextDay(a.day) },
  };
}

export async function POST(req) {
  const user = await userFromRequest(req);
  const db = asUser(req);
  if (!user || !db) return notSignedIn();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const tripId = String(body.trip_id || '');
  /*
   * An activity carries a date and a wall-clock time and no timezone, because
   * "9am" in a plan means nine in the morning where you will be standing. The
   * browser's zone is the closest thing to an answer this app currently holds,
   * and it is right for anyone planning at home for home. It is wrong by the
   * offset for a trip abroad — which is why the button says which zone it used
   * rather than leaving it to be discovered in the calendar.
   */
  const tz = /^[A-Za-z_+-]+\/[A-Za-z_+-]+$/.test(String(body.timezone || ''))
    ? body.timezone : 'UTC';
  if (!tripId) return Response.json({ error: 'Which trip?' }, { status: 400 });

  const { data: trip, error: tripErr } = await db.from('trips')
    .select('id, name').eq('id', tripId).maybeSingle();
  if (tripErr || !trip) {
    return Response.json({ error: 'That trip is not yours to sync.' }, { status: 403 });
  }

  const { data: acts, error: actErr } = await db.from('activities')
    .select('id, day, start_time, end_time, title, location, notes, google_event_id')
    .eq('trip_id', tripId)
    .order('day', { ascending: true });
  if (actErr) return Response.json({ error: 'Could not read the trip.' }, { status: 502 });

  const list = (acts || []).filter((a) => a.day && a.title);
  if (!list.length) return Response.json({ written: 0, updated: 0 });

  let written = 0;
  let updated = 0;
  const failures = [];

  for (const a of list) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await upsertEvent(user.id, eventFor(a, tz), a.google_event_id);
      if (a.google_event_id) updated += 1; else written += 1;
      if (out && out.id && out.id !== a.google_event_id) {
        // eslint-disable-next-line no-await-in-loop
        await db.from('activities').update({ google_event_id: out.id }).eq('id', a.id);
      }
    } catch (e) {
      if (e instanceof NeedsReconnect) {
        return Response.json({ error: e.message, code: 'reconnect' }, { status: 409 });
      }
      failures.push(a.title);
      console.error('[gcal] push failed for', a.title, e.message);
    }
  }

  return Response.json({
    written,
    updated,
    /* Named, not counted: "3 failed" is a puzzle, "Onsen failed" is a thing
       you can go and look at. */
    failed: failures.slice(0, 5),
    timezone: tz,
  });
}
