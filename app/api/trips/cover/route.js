import { asUser } from '@/lib/supabaseServer';
import { COVER_BUCKET, coverPathFor } from '@/lib/tripCover';
import { coverPrompt } from '@/lib/coverPrompt';
import { coverDrawing } from '@/lib/coverDraw';

export const runtime = 'nodejs';
// Drawing a picture takes longer than a database read, and the best quality
// takes the longest. If draws start timing out, raise this to what the
// project's Vercel plan allows.
export const maxDuration = 60;

const IMAGES = 'https://api.openai.com/v1/images/generations';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const say = (message, status) => Response.json({ error: message }, { status });

/*
 * A cover drawn for a trip.
 *
 * The picture is made from the trip's name and where it goes, and nothing
 * else: no stop, no note, no one on it. The one thing they may add is the
 * style, which replaces the look and nothing more (see lib/coverPrompt.js).
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

  const prompt = coverPrompt({ name: trip.name, destination: trip.destination, style: body.style });

  // Wide, as it is drawn across the head of the trip page, and as large as the
  // model draws: it is the picture of the trip, shown wide and opened full
  // size, not a thumbnail. That costs more and takes longer than a small draw,
  // so a redraw is worth a deliberate click.
  const drawing = coverDrawing({
    model: process.env.OPENAI_IMAGE_MODEL, size: process.env.OPENAI_IMAGE_SIZE,
  });

  let made;
  try {
    const upstream = await fetch(IMAGES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        ...drawing,
        prompt,
        output_format: 'webp',
        // Near-lossless, and a good deal smaller than the default. The bucket
        // refuses a file over 6 MiB, and a large picture at full compression
        // can be near that — a draw paid for and then not kept.
        output_compression: 90,
        n: 1,
      }),
    });
    const answer = await upstream.json();
    if (!upstream.ok) {
      const detail = (answer && answer.error && answer.error.message) || '';
      if (upstream.status === 401) return say('OpenAI rejected the API key.', 502);
      if (upstream.status === 429) return say('OpenAI is busy. Try again in a moment.', 429);
      // Words the person typed can be turned down, and OpenAI's own message
      // for that tells them to write to OpenAI, which they cannot act on.
      if (answer && answer.error && answer.error.code === 'moderation_blocked') {
        return say('That request was turned down. Try describing the style another way.', 422);
      }
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
