import { computeRoute, routesKey, routesNotConfigured, routesFailure } from '@/lib/routes';
import { railTransit } from '@/lib/railTransit';

export const runtime = 'nodejs';

const ok = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

/* Two minutes. A walking route is the same all week, but a driving one is
   answered with the traffic on it, and transit with the timetable you are
   standing in — long enough to survive flicking between modes, short enough
   to stay true. */
const FRESH = { 'Cache-Control': 'private, max-age=120' };

/**
 * One route between two points, for one way of travelling.
 *
 *   now     transit leaving now rather than a typical journey (directions on the day)
 *   prefer  a saved route's line ids, put first when they run (trains in Japan)
 *   google  false where the caller knows Google has no such route there
 *           (transit in Japan), so it is not asked for nothing
 */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const { from, to, mode, now, google, prefer } = body || {};
  // A saved route: its line ids, a handful of short strings.
  const saved = Array.isArray(prefer) && prefer.length <= 8 && prefer.every((id) => typeof id === 'string' && id.length <= 120)
    ? prefer : null;
  if (!ok(from) || !ok(to)) {
    return Response.json({ error: 'Need two points.' }, { status: 400 });
  }
  const a = { lat: Number(from.lat), lng: Number(from.lng) };
  const b = { lat: Number(to.lat), lng: Number(to.lng) };

  /*
   * Trains in Japan, which Google's API does not have: greater Tokyo from the
   * operators' timetables, the rest of the country estimated over its whole
   * railway network (lib/railTransit). Neither needs a key or costs anything.
   * Everywhere else, and if they fail, Google answers as before.
   */
  if (mode === 'TRANSIT') {
    try {
      const own = await railTransit({ from: a, to: b, now: !!now, prefer: saved });
      if (own) return Response.json(own, { headers: FRESH });
    } catch (e) {
      console.error('[routes] own transit failed:', e);
    }
    if (google === false) return Response.json({ mode: 'TRANSIT', found: false }, { headers: FRESH });
  }

  if (!routesKey()) return routesNotConfigured();
  try {
    const out = await computeRoute({ from: a, to: b, mode });
    return Response.json(out, { headers: FRESH });
  } catch (e) {
    return routesFailure(e, 'compute');
  }
}
