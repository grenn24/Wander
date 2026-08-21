import { resolveMany, placesKey, notConfigured, placesFailure } from '@/lib/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Turn a batch of location strings into coordinates in one round trip.
 *
 * Called once when a planned trip is saved, so the map is already populated
 * the first time it is opened, instead of resolving stop by stop in the client.
 */
export async function POST(req) {
  if (!placesKey()) return notConfigured();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const items = (Array.isArray(body.items) ? body.items : [])
    .map((i) => ({ id: String(i.id || ''), query: String(i.query || '').trim().slice(0, 300) }))
    .filter((i) => i.id && i.query);

  if (!items.length) return Response.json({ results: [] });

  try {
    const results = await resolveMany(items, String(body.bias || '').slice(0, 200));
    return Response.json({ results });
  } catch (e) {
    return placesFailure(e, 'resolve');
  }
}
