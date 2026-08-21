import { placesKey, notConfigured, placesFailure, reverseGeocode } from '@/lib/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!placesKey()) return notConfigured();
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'Need a point.' }, { status: 400 });
  }
  try {
    return Response.json(await reverseGeocode(lat, lng));
  } catch (e) {
    return placesFailure(e, 'reverse');
  }
}
