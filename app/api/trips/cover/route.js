import { asUser } from '@/lib/supabaseServer';
import { COVER_BUCKET, coverPathFor } from '@/lib/tripCover';

export const runtime = 'nodejs';
// Drawing a picture takes longer than a database read.
export const maxDuration = 60;

const IMAGES = 'https://api.openai.com/v1/images/generations';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const say = (message, status) => Response.json({ error: message }, { status });

/*
 * A cover drawn for a trip.
 *
 * The picture is made from the trip's name and where it goes, and nothing
 * else: no stop, no note, no one on it.
 *
 * Everything but the drawing is done as whoever asked — their own token, their
 * own row level security — so the trip, the file and the row it points at are
 * all reached exactly as the browser would reach them. A trip they are not on
 * is not there to be found. The one thing the browser cannot do is hold the
 * key that draws the picture, which is the only reason this is a route.
 */
export async function POST(req) {
  if (!process.env.OPENAI_API_KEY) return say('Drawing covers needs OPENAI_API_KEY.', 503);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return say('Covers are not configured on this server.', 503);
  }
  const db = asUser(req);
  if (!db) return say('Sign in to change this trip.', 401);

  let body;
  try { body = await req.json(); } catch { return say('Expected a trip.', 400); }
  const tripId = (body && body.tripId) || '';
  if (!UUID.test(tripId)) return say('Expected a trip.', 400);

  const { data: trip, error: tripError } = await db.from('trips')
    .select('id, name, destination, cover_path').eq('id', tripId).maybeSingle();
  if (tripError) {
    const stale = /jwt|token/i.test(tripError.message || '');
    return say(stale ? 'Sign in again to change this trip.' : 'Could not read that trip.', stale ? 401 : 502);
  }
  // Someone else's trip and a trip that never existed look alike from here,
  // which is the point.
  if (!trip) return say('That trip is not yours.', 404);

  const place = (trip.destination || '').trim();
  const prompt = 'A travel poster for a trip, in flat illustration: warm, printed colours, '
    + 'simple shapes, no lettering of any kind and no people in the foreground. '
    + `The trip is called "${(trip.name || 'A trip').slice(0, 80)}"`
    + `${place ? `, and it goes to ${place.slice(0, 80)}` : ''}. `
    + 'Draw the place, not the words.';

  let made;
  try {
    const upstream = await fetch(IMAGES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
        prompt,
        // Wide, as it is drawn across the head of a card, and cheap: it is
        // shown at a few hundred pixels and is asked for again on a whim.
        size: '1536x1024',
        quality: 'low',
        output_format: 'webp',
        n: 1,
      }),
    });
    const answer = await upstream.json();
    if (!upstream.ok) {
      const detail = (answer && answer.error && answer.error.message) || '';
      if (upstream.status === 401) return say('OpenAI rejected the API key.', 502);
      if (upstream.status === 429) return say('OpenAI is busy. Try again in a moment.', 429);
      return say(detail || 'That picture could not be drawn.', 502);
    }
    made = answer && answer.data && answer.data[0] && answer.data[0].b64_json;
  } catch {
    return say('Could not reach OpenAI.', 502);
  }
  if (!made) return say('That picture could not be drawn.', 502);

  const path = coverPathFor(tripId);
  const { error: putError } = await db.storage.from(COVER_BUCKET)
    .upload(path, Buffer.from(made, 'base64'), { contentType: 'image/webp', upsert: false });
  if (putError) return say('The picture was drawn but could not be kept.', 502);

  const { error: saveError } = await db.from('trips')
    .update({ cover_path: path, cover_ref: null, updated_at: new Date().toISOString() })
    .eq('id', tripId);
  if (saveError) {
    await db.storage.from(COVER_BUCKET).remove([path]);
    return say('The picture was drawn but the trip could not be pointed at it.', 502);
  }
  // The one it had is nobody's now.
  if (trip.cover_path) await db.storage.from(COVER_BUCKET).remove([trip.cover_path]);

  return Response.json({ cover_path: path });
}
