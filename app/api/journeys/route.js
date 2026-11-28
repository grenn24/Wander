import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';
import { findRealJourneys } from '@/lib/realJourneys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The journey check, for the pages that make entries in the browser
 * (fetchRealJourneys, lib/entryChecks.js): entries in, the same entries out
 * with their trains, buses and ferries made real (findRealJourneys,
 * lib/realJourneys.js).
 *
 *   { rows, said, currency, zone }  ->  { entries, found, matched, why }
 *
 * `zone` is the trip's clock, which a planned "09:10" is read in. Signed in,
 * as every lookup is a call on the app's Google account.
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
    return Response.json(await findRealJourneys(rows, {
      said: String(body.said || '').slice(0, 6000),
      currency: String(body.currency || ''),
      zone: String(body.zone || '').slice(0, 64),
    }));
  } catch (e) {
    // A trip without timetabled trains is still a trip; the page saves them as written.
    console.error('[journeys] failed:', (e && e.message) || e);
    return Response.json({ error: 'Could not look up those journeys.' }, { status: 502 });
  }
}
