/*
 * Where somebody ends up after signing in.
 *
 * Supabase sends them to whatever address it was given, and to the Site URL —
 * the landing page — when it was given none or refused the one it had. So the
 * landing page used to be where a fresh sign-up arrived: the confirmation link
 * in the email carried no address, and a signed-in person read "Wander" and a
 * hero instead of their trips.
 *
 * Two halves, so neither has to be perfect on its own:
 *   - `returnPath` says where to ask to come back to, so the address is right
 *     for everything sent from here on;
 *   - `authForwardScript` runs on the landing page and moves on anybody who
 *     arrives there carrying a fresh session anyway — the emails already sent,
 *     or a host Supabase would not accept.
 */

/**
 * The page to come back to after signing in: the one being looked at, which for
 * a shared link is the trip itself. The landing page is never the answer — it
 * is not gated, so nobody signs in there, and if they somehow are on it the
 * point of signing in is their trips.
 */
export function returnPath(pathname, search) {
  const path = pathname || '/';
  return path === '/' ? '/trips' : `${path}${search || ''}`;
}

/**
 * Sends a landing-page arrival that has just signed in on to their trips.
 *
 * Self-contained, because the landing page serialises it into an inline script
 * (as lib/accountHint.js does). It has to run while the page is being parsed
 * and not from the SDK's callback: the SDK reads the session out of the URL
 * fragment and removes it, and after that there is nothing to tell an arrival
 * from a visit. Only a fragment that carries a token counts, so `#features` and
 * `#how` keep working, and a link that failed (`#error=…`) stays where it is.
 * The fragment is passed along so the trips page can read the session from it.
 */
export function forwardAuthArrival(loc) {
  if (loc.pathname === '/' && /[#&]access_token=/.test(loc.hash || '')) {
    loc.replace(`/trips${loc.search || ''}${loc.hash}`);
    return true;
  }
  return false;
}

/** The inline script for the landing page. */
export function authForwardScript() {
  return `(${forwardAuthArrival.toString()})(window.location);`;
}
