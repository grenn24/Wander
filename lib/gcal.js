'use client';

/**
 * Talking to our own calendar routes from the browser.
 *
 * Every one of them needs to know who is asking, and the only proof of that
 * worth anything is the Supabase access token — so it goes on every request
 * and the server checks it rather than believing a user id in a body.
 */

async function ask(supabase, path, init = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session ? data.session.access_token : '';
  if (!token) throw new Error('Sign in first.');

  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'That did not work.');
    err.code = body.code || '';
    err.status = res.status;
    throw err;
  }
  return body;
}

export function calendarStatus(supabase) {
  return ask(supabase, '/api/google/connect');
}

/** Hand the freshly issued Google tokens over for safekeeping. */
export function keepCalendar(supabase, tokens) {
  return ask(supabase, '/api/google/connect', {
    method: 'POST',
    body: JSON.stringify(tokens),
  });
}

export function dropCalendar(supabase) {
  return ask(supabase, '/api/google/connect', { method: 'DELETE' });
}

export function calendarEvents(supabase, from, to) {
  return ask(supabase, `/api/google/events?from=${from}&to=${to}`);
}

export function unpushTrip(supabase, tripId) {
  return ask(supabase, '/api/google/push', {
    method: 'DELETE',
    body: JSON.stringify({ trip_id: tripId }),
  });
}

export function pushTrip(supabase, tripId) {
  return ask(supabase, '/api/google/push', {
    method: 'POST',
    body: JSON.stringify({
      trip_id: tripId,
      // The one thing the browser knows that the server does not.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }),
  });
}
