import { placesKey, notConfigured, placesFailure, placeDetails } from '@/lib/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What Google knows about a place: its photographs, its rating, its reviews. */
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
    /*
     * Cached at the edge, keyed by the place.
     *
     * This is the priciest of the three calls — Place Details bills per
     * request — and it used to fire every single time anyone opened an
     * activity that had a pin. The answer is the same for every reader and
     * changes about as often as a restaurant redecorates, so six hours at the
     * CDN turns "once per person per open" into "once per place".
     */
    return Response.json(await placeDetails(id), {
      headers: {
        'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400',
      },
    });
  } catch (e) {
    return placesFailure(e, 'details');
  }
}
