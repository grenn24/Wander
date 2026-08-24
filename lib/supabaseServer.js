import { createClient } from '@supabase/supabase-js';

/**
 * Supabase from a route handler, which is a different proposition from
 * Supabase in the browser.
 *
 * Everything else in this app talks to the database directly from the client
 * and lets row level security decide what is allowed. That works because every
 * row belongs to a trip and every trip has members. It does not work for a
 * Google refresh token: the whole point of holding one is that the person it
 * belongs to should not be able to fish it back out of an API response, and
 * neither should anything that gets hold of their session.
 *
 * So the token table has RLS on and no policies at all — invisible to every
 * JWT — and only these two functions reach it, from the server, with the
 * service role key.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function usable(v) {
  return !!v && !v.startsWith('REPLACE_WITH');
}

export function serverConfigured() {
  return usable(URL) && usable(SERVICE);
}

/**
 * The service-role client. Bypasses row level security entirely, so it is only
 * ever used after the caller has been identified by `userFromRequest`, and
 * only against the tables that exist for it.
 */
export function admin() {
  if (!serverConfigured()) return null;
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Who is asking.
 *
 * The browser sends its Supabase access token; this asks Supabase whose it is.
 * A route that skipped this and trusted a user id in the request body would be
 * handing anyone's calendar to anyone who could type a UUID.
 */
export async function userFromRequest(req) {
  if (!usable(URL) || !usable(ANON)) return null;
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data || !data.user) return null;
  return data.user;
}

/**
 * The database as this caller sees it: their own JWT, so row level security
 * applies exactly as it does in the browser.
 *
 * Used wherever a route needs the trip itself. Reading it back through RLS is
 * what stops "sync trip X" from being a way to read a trip you are not in —
 * far better than trusting a trip the request handed us.
 */
export function asUser(req) {
  if (!usable(URL) || !usable(ANON)) return null;
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** The 401 every one of these routes gives to a request it cannot place. */
export function notSignedIn() {
  return Response.json({ error: 'Sign in first.' }, { status: 401 });
}
