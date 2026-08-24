import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';
import { listEvents, NeedsReconnect } from '@/lib/googleCal';

export const runtime = 'nodejs';

/**
 * What is already booked, for one stretch of dates.
 *
 * Bounded by the trip on purpose. There is no reason for a travel planner to
 * hold a year of somebody's calendar, and a request that could ask for one
 * would eventually be made to.
 */
export async function GET(req) {
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();

  const { searchParams } = new URL(req.url);
  const from = String(searchParams.get('from') || '');
  const to = String(searchParams.get('to') || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return Response.json({ error: 'Give a from and a to, as YYYY-MM-DD.' }, { status: 400 });
  }
  if (to < from) {
    return Response.json({ error: 'Those dates are the wrong way round.' }, { status: 400 });
  }

  try {
    // The whole of the last day, not up to midnight at the start of it.
    const events = await listEvents(
      user.id,
      new Date(`${from}T00:00:00Z`).toISOString(),
      new Date(`${to}T23:59:59Z`).toISOString(),
    );
    return Response.json({ events });
  } catch (e) {
    if (e instanceof NeedsReconnect) {
      return Response.json({ error: e.message, code: 'reconnect' }, { status: 409 });
    }
    console.error('[gcal] events failed:', e.message);
    return Response.json({ error: 'Could not read your calendar just now.' }, { status: 502 });
  }
}
