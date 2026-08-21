import { googleKey, notConfigured, explain, nearbyPlaces } from '@/lib/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!googleKey()) return notConfigured();
  let body;
  try { body = await req.json(); } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'Need a point to search around.' }, { status: 400 });
  }
  try {
    const places = await nearbyPlaces(lat, lng, String(body.kind || ''), Number(body.radius) || 900);
    return Response.json({ places });
  } catch (e) {
    return Response.json({ error: explain(e) }, { status: 502 });
  }
}
