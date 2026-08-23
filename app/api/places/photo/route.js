import { placesKey } from '@/lib/places';

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
  const width = Math.min(1600, Math.max(80, Number(searchParams.get('w')) || 400));

  // Only ever a Google photo resource name — never an arbitrary URL.
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(ref)) {
    return new Response('Bad photo reference.', { status: 400 });
  }

  const url = `https://places.googleapis.com/v1/${ref}/media`
    + `?maxWidthPx=${width}&key=${encodeURIComponent(key)}`;

  let upstream;
  try {
    upstream = await fetch(url, { redirect: 'follow' });
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
