import { calendarEvent } from '@/lib/calendarEvents';
import { validZone } from '@/public/trip-time';
import { userFromRequest, asUser, notSignedIn } from '@/lib/supabaseServer';
import {
  upsertEvent, deleteEvent, findTripEvents, stamp, NeedsReconnect,
} from '@/lib/googleCal';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The trip, written into someone's own calendar.
 *
 * The trip is read back out of the database through the caller's own row level
 * security rather than taken from the request, so "sync trip X" cannot be used
 * to read a trip you are not a member of. What the request supplies is a trip
 * id. Time zones come from the saved trip and flight details.
 */

/**
 * Take this trip back out of the calendar.
 *
 * Two sources for what to remove, deliberately. The ids stored on the
 * activities are the exact answer for everything still in the trip; the search
 * by mark catches what the trip has since forgotten — an activity deleted here
 * after it was written there, which would otherwise be left behind for good
 * with nothing left pointing at it.
 */
export async function DELETE(req) {
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
  if (!tripId) return Response.json({ error: 'Which trip?' }, { status: 400 });

  const { data: trip } = await db.from('trips').select('id').eq('id', tripId).maybeSingle();
  if (!trip) return Response.json({ error: 'That trip is not yours.' }, { status: 403 });

  const { data: acts } = await db.from('activities')
    .select('id, google_event_id').eq('trip_id', tripId).not('google_event_id', 'is', null);

  const ids = new Set((acts || []).map((a) => a.google_event_id).filter(Boolean));
  try {
    (await findTripEvents(user.id, tripId)).forEach((id) => ids.add(id));
  } catch (e) {
    if (e instanceof NeedsReconnect) {
      return Response.json({ error: e.message, code: 'reconnect' }, { status: 409 });
    }
    // The stored ids are still worth acting on without the search.
    console.error('[gcal] tag search failed:', e.message);
  }

  let removed = 0;
  for (const id of ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await deleteEvent(user.id, id);
      removed += 1;
    } catch (e) {
      if (e instanceof NeedsReconnect) {
        return Response.json({ error: e.message, code: 'reconnect' }, { status: 409 });
      }
      console.error('[gcal] delete failed:', e.message);
    }
  }

  /* Cleared whatever happened above: an id that no longer names anything is
     worse than no id, because the next sync would try to edit a hole. */
  if ((acts || []).length) {
    await db.from('activities').update({ google_event_id: null }).eq('trip_id', tripId);
  }

  return Response.json({ removed });
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
  if (!tripId) return Response.json({ error: 'Which trip?' }, { status: 400 });

  const { data: trip, error: tripErr } = await db.from('trips')
    .select('id, name, timezone').eq('id', tripId).maybeSingle();
  if (tripErr || !trip) {
    return Response.json({ error: 'That trip is not yours to sync.' }, { status: 403 });
  }

  const tz = trip.timezone;
  if (!validZone(tz)) return Response.json({ error: 'Choose the destination time zone in trip settings before syncing.' }, { status: 400 });

  const { data: acts, error: actErr } = await db.from('activities')
    .select('id, day, start_time, end_time, title, location, notes, booking_ref, category, subtype, details, google_event_id')
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
      const out = await upsertEvent(user.id, { ...calendarEvent(a, tz), extendedProperties: stamp(tripId) }, a.google_event_id);
      if (a.google_event_id) updated += 1; else written += 1;
      if (out && out.id && out.id !== a.google_event_id) {
        // eslint-disable-next-line no-await-in-loop
        await db.from('activities').update({ google_event_id: out.id }).eq('id', a.id);
      }
    } catch (e) {
      if (e instanceof NeedsReconnect) {
        return Response.json({ error: e.message, code: 'reconnect' }, { status: 409 });
      }
      failures.push({ title: a.title, why: (e && e.message) || 'unknown' });
      console.error('[gcal] push failed for', a.title, e.message);
    }
  }

  return Response.json({
    written,
    updated,
    /* Named and explained. "3 failed" is a puzzle; "Onsen failed" is a thing
       you can go and look at; "Onsen failed — invalid end time" is a thing you
       can fix. Google's own words, because ours would only be a guess at
       them. */
    failed: failures.slice(0, 5),
    timezone: tz,
  });
}
