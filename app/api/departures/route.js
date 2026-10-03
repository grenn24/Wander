import { timetablesFor } from '@/lib/timetableRegions';
import { earliestJourney, typicalJourney, tokyoClock } from '@/lib/timetable';
import { departures, dayOf } from '@/lib/departures';

export const runtime = 'nodejs';

const ok = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
const FRESH = { 'Cache-Control': 'private, max-age=60' };

/**
 * One train of a train option's departures for the rest of the day: every
 * train of its line leaving the same station the same way, that stops where
 * you get off, and when each gets you to the end of the journey.
 *
 *   from, to  the hop's two ends
 *   option    the option's id, its lines' ids joined by '>' (lib/trainOptions)
 *   ride      which of its trains: 0 for the first
 *   after     the minute of the service day to list from (past midnight is 1440 on)
 *   date      the day, YYYY-MM-DD, for its timetable; or now: true for today's
 *
 * Answers { from, toward, trains: [{ leaves, reaches, arrives, type }], last },
 * minutes of the service day, or { trains: [] } where no timetable has the line.
 */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const { from, to, option, ride = 0, after, date, now } = body || {};
  if (!ok(from) || !ok(to) || typeof option !== 'string' || option.length > 600) {
    return Response.json({ error: 'Need two points and an option.' }, { status: 400 });
  }
  const a = { lat: Number(from.lat), lng: Number(from.lng) };
  const b = { lat: Number(to.lat), lng: Number(to.lng) };
  const clock = tokyoClock();
  const day = now ? clock.day : /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? dayOf(date) : 'weekday';
  const start = Number.isFinite(Number(after)) ? Math.max(0, Math.min(27 * 60, Number(after))) : clock.minute;

  try {
    const ids = option.split('>');
    for (const { net } of await timetablesFor({ from: a, to: b, day })) {
      const lines = ids.map((id) => net.lines.findIndex((l) => l[0] === id));
      if (lines.some((i) => i < 0)) continue;
      const only = new Set(lines);
      // The journey over these lines, for which station, which way and where off: from now, or a usual day.
      const journey = earliestJourney(net, a, b, start, { only }) || typicalJourney(net, a, b, undefined, { only });
      const rides = journey ? journey.legs.filter((l) => l.kind === 'ride') : [];
      const leg = rides[Number(ride) || 0];
      if (!leg) continue;
      const rest = rides.slice((Number(ride) || 0) + 1).map((r) => r.lineIndex);
      const found = departures(net, leg, { rest, to: b, after: start });
      return Response.json({ from: net.stops[leg.from].name, toward: leg.toward, ...found }, { headers: FRESH });
    }
    return Response.json({ trains: [], last: null }, { headers: FRESH });
  } catch (e) {
    console.error('[departures] failed:', e);
    return Response.json({ error: 'Could not list the trains.' }, { status: 500 });
  }
}
