import { admin } from '@/lib/supabaseServer';
import { readCommandCalendar } from './commandCalendar.js';

export async function commandCalendar(userId, trip) {
  const token = await accessToken(userId);
  const signal = AbortSignal.timeout(30000);
  return readCommandCalendar((path) => call(token, path, { signal }), trip);
}

/**
 * Google Calendar, server side only.
 *
 * Two scopes and two directions. Reading tells the planner what is already in
 * the way — a meeting on the Tuesday morning it wanted to put a day trip in.
 * Writing puts the trip where the rest of someone's life already is, which is
 * the only place they will actually look at it while travelling.
 *
 * The access token is short-lived and is refreshed here rather than stored
 * anywhere a browser can reach. The refresh token is the real credential and
 * never leaves this file's callers.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';

/* Read what is already booked, and write the trip back. Asked for together, so
   one consent covers both and nobody is sent round the loop twice. */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

/* The pair that already sets up Google sign-in. Same client, same names it is
   deployed under; there is no second copy of it to keep in step. */
function env(name) {
  const v = process.env[name] || '';
  return v.startsWith('REPLACE_WITH') ? '' : v;
}

function clientId() {
  return env('GOOGLE_OAUTH_CLIENT_ID');
}

function clientSecret() {
  return env('GOOGLE_OAUTH_CLIENT_SECRET');
}

export function calendarConfigured() {
  return !!clientId() && !!clientSecret();
}

/** Thrown when the connection is gone and the only fix is to connect again. */
export class NeedsReconnect extends Error {
  constructor(message) {
    super(message || 'That Google connection has expired.');
    this.code = 'reconnect';
  }
}

/** What we hold for someone, or null. */
export async function connection(userId) {
  const db = admin();
  if (!db) return null;
  const { data } = await db.from('google_tokens').select('*').eq('user_id', userId).maybeSingle();
  return data || null;
}

export async function saveConnection(userId, patch) {
  const db = admin();
  if (!db) throw new Error('The server is not configured for this.');
  const { error } = await db.from('google_tokens').upsert({
    user_id: userId,
    ...patch,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function forget(userId) {
  const db = admin();
  if (!db) return;
  await db.from('google_tokens').delete().eq('user_id', userId);
}

/**
 * A usable access token, refreshed if the stored one is past it.
 *
 * A minute of slack, because a token that expires while the request is in
 * flight fails in a way that looks like a permissions problem rather than a
 * timing one.
 */
export async function accessToken(userId) {
  const held = await connection(userId);
  if (!held) throw new NeedsReconnect('No Google Calendar is connected.');

  const soon = Date.now() + 60000;
  if (held.access_token && held.expires_at && new Date(held.expires_at).getTime() > soon) {
    return held.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: held.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    /*
     * `invalid_grant` means the refresh token is dead — revoked in the Google
     * account, or expired after six months of not being used. Nothing here can
     * mend that, and keeping the row would make every future call fail the
     * same way, so it goes.
     */
    if (body.error === 'invalid_grant') {
      await forget(userId);
      throw new NeedsReconnect('Google has ended that connection. Connect it again.');
    }
    throw new Error(body.error_description || body.error || 'Google refused to refresh the token.');
  }

  const expires = new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000).toISOString();
  await saveConnection(userId, {
    refresh_token: held.refresh_token,
    access_token: body.access_token,
    expires_at: expires,
    scope: body.scope || held.scope || '',
  });
  return body.access_token;
}

/** Tell Google to forget us too, not just our own table. */
export async function revoke(refreshToken) {
  if (!refreshToken) return;
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch (e) {
    // Our own row is gone either way; a failed revoke is not worth an error
    // screen on a disconnect that otherwise worked.
  }
}

async function call(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body.error && body.error.message) || `Google returned ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new NeedsReconnect(detail);
    throw new Error(detail);
  }
  return body;
}

/**
 * What is already in the way, between two dates.
 *
 * Thin, but not so thin as to be useless. It used to return a title and two
 * times and nothing else — so an event with the venue's address and the dress
 * code and the couple's names in it arrived here as the word "Wedding", and
 * every screen downstream could only repeat that back. The address and the
 * first part of the description come too, because they are the reason anybody
 * connected a calendar to a travel planner.
 *
 * Still bounded: the trip's dates, and a few hundred characters of the note.
 * Nothing else from the event is read.
 */
export async function listEvents(userId, fromISO, toISO) {
  const token = await accessToken(userId);
  const q = new URLSearchParams({
    timeMin: fromISO,
    timeMax: toISO,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const body = await call(token, `/calendars/primary/events?${q}`);
  return (body.items || [])
    .filter((e) => e.status !== 'cancelled')
    /*
     * Not the ones we put there.
     *
     * Sync a trip to the calendar and every activity in it comes back through
     * this call looking like a prior commitment — so the planner would be told
     * to plan around the plan it had just written, and asked to avoid clashing
     * with itself. The mark that makes an event removable also makes it
     * recognisable as ours.
     */
    .filter((e) => !(e.extendedProperties
      && e.extendedProperties.private
      && e.extendedProperties.private.wanderTrip))
    .map((e) => ({
      id: e.id,
      title: String(e.summary || 'Busy').slice(0, 120),
      // An all-day event has `date`; a timed one has `dateTime`.
      allDay: !!(e.start && e.start.date),
      start: (e.start && (e.start.dateTime || e.start.date)) || '',
      end: (e.end && (e.end.dateTime || e.end.date)) || '',
      where: String((e.location || '')).slice(0, 200),
      details: String((e.description || '')).replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ').trim().slice(0, 400),
    }))
    .filter((e) => e.start);
}

/**
 * The mark that says an event came from here, and from which trip.
 *
 * Google carries these through every edit and never shows them, and they can
 * be searched on. Storing the event id on the activity is the fast path back;
 * this is the one that still works when that path is gone — an activity
 * deleted, a trip rebuilt — which is exactly when somebody wants their
 * calendar tidied and has nothing left to tidy it with.
 */
export function stamp(tripId) {
  return { private: { wanderTrip: String(tripId) } };
}

/** Every event this trip has left in the calendar, however it got there. */
export async function findTripEvents(userId, tripId) {
  const token = await accessToken(userId);
  const q = new URLSearchParams({
    privateExtendedProperty: `wanderTrip=${tripId}`,
    showDeleted: 'false',
    maxResults: '250',
  });
  const body = await call(token, `/calendars/primary/events?${q}`);
  return (body.items || []).filter((e) => e.status !== 'cancelled').map((e) => e.id);
}

/**
 * Take one back out.
 *
 * An event already gone is the outcome being asked for, so a 404 or a 410 is
 * success wearing an error's clothes.
 */
export async function deleteEvent(userId, eventId) {
  const token = await accessToken(userId);
  const res = await fetch(
    `${API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.ok || res.status === 404 || res.status === 410) return true;
  if (res.status === 401 || res.status === 403) throw new NeedsReconnect('Google refused that.');
  throw new Error(`Google returned ${res.status}`);
}

/**
 * Put one activity in the calendar, or bring the one already there up to date.
 *
 * `google_event_id` on the activity is what makes a second sync an edit rather
 * than a duplicate — which is the difference between this being useful and it
 * being a thing you use once and then regret.
 */
export async function upsertEvent(userId, event, existingId) {
  const token = await accessToken(userId);
  if (existingId) {
    try {
      return await call(token, `/calendars/primary/events/${encodeURIComponent(existingId)}`, {
        method: 'PATCH',
        body: JSON.stringify(event),
      });
    } catch (e) {
      // Deleted from the calendar by hand since we last wrote it: writing it
      // again is the sensible reading of "sync", not an error.
      if (!/not found|deleted/i.test(e.message || '')) throw e;
    }
  }
  return call(token, '/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify(event),
  });
}
