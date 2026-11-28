import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';
import { findRealStays } from '@/lib/realStays';
import { homeOf } from '@/lib/home';
import { airports, airportOf } from '@/lib/airports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The stay check, for the pages that make entries in the browser
 * (fetchRealStays, lib/entryChecks.js): entries in, the same entries out with
 * their hotels made real (findRealStays, lib/realStays.js).
 *
 *   { rows, currency }  ->  { entries, found, matched, why }
 *
 * Signed in, because every search is counted against one budget an hour
 * shared with the flight check (lib/serpApi.js). Rates are as sold where the
 * traveller lives, when the account has a home (lib/home.js).
 */
export async function POST(req) {
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();
  let body;
  try { body = (await req.json()) || {}; } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 300)
    .map((r) => (r && typeof r === 'object' ? r : {}));
  try {
    let country = '';
    const home = homeOf(user);
    if (home) {
      try { country = (airportOf(await airports(), home.airports[0]) || {}).country || ''; } catch (e) { /* no market */ }
    }
    const out = await findRealStays(rows, {
      currency: String(body.currency || ''),
      userId: user.id,
      country,
    });
    return Response.json(out);
  } catch (e) {
    // A trip without hotel rates is still a trip; the page saves them as written.
    console.error('[stays] failed:', (e && e.message) || e);
    return Response.json({ error: 'Could not look up hotels.' }, { status: 502 });
  }
}
