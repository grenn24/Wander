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
  try {
    return Response.json({ places: await searchPlaces(q, 6) });
  } catch (e) {
    return placesFailure(e, 'search');
  }
}
