import { placesKey, notConfigured, placesFailure, searchPlaces } from '@/lib/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!placesKey()) return notConfigured();
  let body;
  try { body = await req.json(); } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const q = String(body.query || '').trim().slice(0, 300);
  if (!q) return Response.json({ places: [] });
  // Where the reader is looking, so "coffee" means coffee here.
  const near = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng))
    ? { lat: Number(body.lat), lng: Number(body.lng), radius: Number(body.radius) || 3000 }
    : null;
  try {
    return Response.json({ places: await searchPlaces(q, 12, near) });
  } catch (e) {
    return placesFailure(e, 'search');
  }
}
