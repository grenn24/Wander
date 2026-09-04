import { placesKey, notConfigured, placesFailure, nearbyPlaces } from '@/lib/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!placesKey()) return notConfigured();
  let body;
  try { body = await req.json(); } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const lat = typeof body?.lat === 'number' ? body.lat : NaN;
  const lng = typeof body?.lng === 'number' ? body.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'Need a point to search around.' }, { status: 400 });
  }
  try {
    const places = await nearbyPlaces(lat, lng, String(body.kind || ''), Number(body.radius) || 900, body.bounds ?? null);
    return Response.json({ places });
  } catch (e) {
    if (e.status === 400) return Response.json({ error: e.message }, { status: 400 });
    return placesFailure(e, 'nearby');
  }
}
