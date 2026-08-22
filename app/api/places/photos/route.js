import { placesKey, notConfigured, placesFailure, placePhotos } from '@/lib/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The photo references Google holds for a place, for the editor's photo strip. */
export async function GET(req) {
  if (!placesKey()) return notConfigured();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('place_id') || '';
  // Google place ids are opaque tokens; anything else is not one, and this
  // value goes into a URL path.
  if (!/^[A-Za-z0-9_-]{6,255}$/.test(id)) {
    return Response.json({ error: 'Need a place.' }, { status: 400 });
  }
  try {
    return Response.json({ photos: await placePhotos(id) });
  } catch (e) {
    return placesFailure(e, 'photos');
  }
}
