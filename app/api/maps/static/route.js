import { geocodingKey } from '@/lib/places';
import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';
import { staticMapOptions, staticMapURL } from '@/lib/staticMap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const options = staticMapOptions(new URL(req.url).searchParams);
  if (!options) return new Response('Invalid map coordinates.', { status: 400 });
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();
  const key = process.env.MAPS_STATIC_API_KEY || geocodingKey();
  if (!key || key.startsWith('REPLACE_WITH')) return new Response('Static maps are not configured.', { status: 503 });
  try {
    // The Google key never reaches the browser; callers cannot supply a URL,
    // arbitrary styling, or unbounded image sizes. Do not store map imagery.
    const upstream = await fetch(staticMapURL(options, key), {
      cache: 'no-store', signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith('image/')) {
      return new Response('Static preview unavailable. Open the interactive map.', { status: 502 });
    }
    return new Response(upstream.body, { headers: {
      'Content-Type': upstream.headers.get('content-type'),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return new Response('Static preview unavailable. Open the interactive map.', { status: 502 });
  }
}
