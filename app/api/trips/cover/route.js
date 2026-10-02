import { asUser } from '@/lib/supabaseServer';
import {
  COVER_BUCKET, COVER_LIBRARY_FULL, COVER_LIBRARY_MAX, coverEntries, coverPathFor, coversFrom,
} from '@/lib/tripCover';
import { coverPrompt } from '@/lib/coverPrompt';
import { coverDrawing } from '@/lib/coverDraw';

export const runtime = 'nodejs';
// Drawing a picture takes longer than a database read, and a large one at the
// best quality takes the longest — well past a minute, which is what this was
// first set to. If the project's plan will not allow this much, the deployment
// is refused at build time and this is the number to bring down.
export const maxDuration = 300;

// Stop waiting a little before the platform would stop us, so a slow drawing
// is answered with a reason instead of a bare 504 — and with room left to keep
// a picture that arrives at the last moment.
const DRAW_BUDGET_MS = (maxDuration - 20) * 1000;

const IMAGES = 'https://api.openai.com/v1/images/generations';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const say = (message, status) => Response.json({ error: message }, { status });

/*
 * A cover drawn for a trip, added to the covers it keeps and put on the trip.
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

  // Before paying for a picture there is no room to keep.
  let kept;
  try { kept = coversFrom(tripId, await coverEntries(db, tripId), trip.cover_path).length; }
  catch { return say('Could not read this trip’s covers.', 502); }
  if (kept >= COVER_LIBRARY_MAX) return say(COVER_LIBRARY_FULL, 409);

  const prompt = coverPrompt({ name: trip.name, destination: trip.destination, style: body.style });

  // Wide, as it is drawn across the head of the trip page, and as large as the
  // model draws: it is the picture of the trip, shown wide and opened full
  // size, not a thumbnail. That costs more and takes longer than a small draw,
  // so a redraw is worth a deliberate click.
  const drawing = coverDrawing({
    model: process.env.OPENAI_IMAGE_MODEL,
    size: process.env.OPENAI_IMAGE_SIZE,
    quality: process.env.OPENAI_IMAGE_QUALITY,
  });

  let made;
  try {
    const upstream = await fetch(IMAGES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(DRAW_BUDGET_MS),
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
  } catch (error) {
    if (error && error.name === 'TimeoutError') {
      // What was asked for, in the log, is what the owner needs to change.
      console.warn('[cover] drawing timed out', drawing);
      return say('That took too long to draw. Try again in a moment.', 504);
    }
    return say('Could not reach OpenAI.', 502);
  }
  if (!made) return say('That picture could not be drawn.', 502);

  const path = coverPathFor(tripId, 'webp', 'drawn');
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
  // The cover it had is left in the bucket on purpose: a redraw moves the
  // trip's pointer and keeps what came before. Only a member deleting a cover
  // takes it away.
  return Response.json({ cover_path: path });
}
