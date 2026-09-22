import { leadPhoto, placeOfPhoto, placesKey } from '@/lib/places';

export const runtime = 'nodejs';

/**
 * Streams a place photo through the server so the Places key never reaches the
 * browser. `ref` is a Google photo resource name, stored on the activity.
 *
 * Photo bytes are immutable for a given reference, so they cache hard; only the
 * signed URL behind them is short-lived, which is why the reference is what
 * gets stored rather than a URL.
 */
export async function GET(req) {
  const key = placesKey();
  if (!key) return new Response('Place photos are not configured.', { status: 503 });

  const { searchParams } = new URL(req.url);
  const ref = searchParams.get('ref') || '';
  // Google serves up to 4800 pixels; the viewer asks for as much as the
  // screen can show, and a cap at 1600 made full-screen photographs soft.
  const width = Math.min(4800, Math.max(80, Number(searchParams.get('w')) || 400));

  // Only ever a Google photo resource name — never an arbitrary URL.
  const placeId = placeOfPhoto(ref);
  if (!placeId) return new Response('Bad photo reference.', { status: 400 });

  const media = (name) => fetch(`https://places.googleapis.com/v1/${name}/media`
    + `?maxWidthPx=${width}&key=${encodeURIComponent(key)}`, { redirect: 'follow' });

  let upstream;
  try {
    upstream = await media(ref);
    /*
     * References are only good for a while, and the ones stored with stops go
     * stale (lib/places, placeOfPhoto): Google refuses them. The place's own
     * lead photo is served in its place, so an old stop still has its picture.
     */
    if (!upstream.ok && [400, 403, 404].includes(upstream.status)) {
      const fresh = await leadPhoto(placeId).catch(() => '');
      if (fresh && fresh !== ref) upstream = await media(fresh);
    }
  } catch (e) {
    return new Response('Could not fetch the photo.', { status: 502 });
  }
  if (!upstream.ok) return new Response('Photo unavailable.', { status: upstream.status });

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      /*
       * A day in the browser, a month at the edge. The bytes behind a photo
       * reference never change, so every reader after the first is served
       * without touching Google at all — which is where most of the saving in
       * this app is, since a trip with twenty stops paints twenty thumbnails.
       */
      'Cache-Control': 'public, max-age=86400, s-maxage=2592000, immutable',
    },
  });
}
