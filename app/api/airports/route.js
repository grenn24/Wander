import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';
import { placesKey, searchPlaces } from '@/lib/places';
import {
  airports, nearestAirports, airportsAround, airportsNamed, airportBrief,
} from '@/lib/airports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A home, from what someone typed: where it is, the airports the planner
 * would fly them from, and the others near enough to choose instead.
 *
 *   { query: 'Shoreditch' }  ->  { home: { label, lat, lng, airports }, around: [...] }
 *
 * Google finds the place when it can be asked; without it, a city or an
 * airport code is matched against the airport table, which is enough for
 * "Singapore" or "LHR". Nothing is saved here — the page keeps the answer
 * on the account with the person's own session (lib/home.js).
 */
export async function POST(req) {
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();
  let body;
  try { body = (await req.json()) || {}; } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const query = String(body.query || '').trim().slice(0, 160);
  if (!query) return Response.json({ error: 'Type a town, a city or an airport.' }, { status: 400 });
  const index = await airports();

  let place = null;
  if (placesKey()) {
    try {
      const [p] = await searchPlaces(query, 1);
      if (p && Number.isFinite(p.lat)) place = { label: p.label || p.name || query, lat: p.lat, lng: p.lng };
    } catch (e) {
      console.warn('[airports] place lookup failed:', e.message);
    }
  }
  if (!place) {
    const [a] = airportsNamed(index, query, 1);
    if (a) place = { label: a.city || query, lat: a.lat, lng: a.lng };
  }
  if (!place) {
    return Response.json({ error: `Could not find ${query}. Try the nearest city or its airport code.` }, { status: 404 });
  }

  const near = nearestAirports(index, place.lat, place.lng);
  const around = airportsAround(index, place.lat, place.lng);
  near.forEach((a) => { if (!around.some((b) => b.code === a.code)) around.push(a); });
  if (!near.length) {
    return Response.json({ error: `There are no airports with flights near ${place.label}.` }, { status: 404 });
  }
  return Response.json({
    home: { ...place, airports: near.map((a) => a.code) },
    around: around.map((a) => ({ ...airportBrief(a), km: Math.round(a.km) })),
  });
}
