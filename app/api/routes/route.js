import { computeRoute, routesKey, routesNotConfigured, routesFailure } from '@/lib/routes';

export const runtime = 'nodejs';

const ok = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

/** One route between two points, for one way of travelling. */
export async function POST(req) {
  if (!routesKey()) return routesNotConfigured();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const { from, to, mode } = body || {};
  if (!ok(from) || !ok(to)) {
    return Response.json({ error: 'Need two points.' }, { status: 400 });
  }

  try {
    const out = await computeRoute({
      from: { lat: Number(from.lat), lng: Number(from.lng) },
      to: { lat: Number(to.lat), lng: Number(to.lng) },
      mode,
    });
    return Response.json(out, {
      headers: {
        /* Two minutes. A walking route is the same all week, but a driving one
           is answered with the traffic on it, and transit with the timetable
           you are standing in — long enough to survive flicking between modes,
           short enough to stay true. */
        'Cache-Control': 'private, max-age=120',
      },
    });
  } catch (e) {
    return routesFailure(e, 'compute');
  }
}
