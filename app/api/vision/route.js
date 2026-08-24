import {
  aiConfigured, notConfigured, aiFailure, askJson,
} from '@/lib/ai';

export const runtime = 'nodejs';

/**
 * What a picture says about a trip.
 *
 * Deliberately not the planner. Reading an image and planning a week are two
 * different jobs, and running them as one call would mean the model deciding
 * halfway through a streamed itinerary that it could not read the picture
 * after all — a refusal arriving after three days of plan had already been
 * written on screen. So this answers one question first, in one small call:
 * is there a trip in here, and if so, what?
 *
 * Its output is an ordinary planning brief in words, which the existing
 * planner then takes exactly as if someone had typed it. Nothing downstream
 * needs to know a photograph was involved.
 */

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['usable', 'reason', 'read', 'brief'],
  properties: {
    usable: {
      type: 'boolean',
      description: 'True only if the picture contains something a trip could be planned from.',
    },
    reason: {
      type: 'string',
      description: 'When not usable: one plain sentence telling the traveller what was '
        + 'in the picture and what would work better. Empty when usable.',
    },
    read: {
      type: 'string',
      description: 'What the picture is, in under ten words — "a handwritten list of '
        + 'Kyoto temples", "the Duomo in Florence". Always filled in.',
    },
    brief: {
      type: 'string',
      description: 'The planning brief: every place name, date, time and constraint '
        + 'you can read, written as instructions to a travel planner. Empty when not usable.',
    },
  },
};

const SYSTEM = `You read one or more photographs and decide whether a trip can be
planned from them.

Several pictures are one request, not several: read them together and write a
single brief covering all of them, in the order they were given. If only some
of them have anything to do with a trip, work from those and ignore the rest —
that still counts as usable.

What counts as usable:
- A written or printed itinerary, list of places, or set of notes — transcribe
  every place name exactly as written, and keep any dates, times and order.
- A recognisable place: a landmark, a street, a skyline, a restaurant front, a
  signposted station. Name it as precisely as you honestly can.
- A screenshot of a map, a booking, a boarding pass, an article or a post about
  somewhere — read the places, dates and times out of it.
- A menu, a poster or a flyer that names a venue or an event.

What is not usable:
- No place in it at all: a pet, a meal with no venue, a blank wall, a meme, a
  document about something else entirely.
- Too blurred, dark or cropped to read.
- A place you genuinely cannot narrow down. "Somewhere tropical" is a guess,
  not a reading — say you could not tell rather than inventing a destination.

Rules:
- Never identify, describe or speculate about individual people. If there are
  people in the picture, ignore them and read the place behind them.
- Prefer what is written over what you infer. A sign saying "Nishiki Market" is
  worth more than an impression of the architecture.
- Do not invent dates, prices or opening hours that are not in the picture.
- If you are confident about a country or city but not the exact spot, that is
  still usable — say what you are sure of and say what you are not.
- "read" is always filled in, including when the answer is no. With several
  pictures, say what they add up to rather than listing them one by one.`;

/* Big enough for a few photographs, small enough that nobody uploads a RAW
   file through it. The client shrinks before sending; this is the backstop. */
const MAX_CHARS = 6_000_000;
/* Kept in step with MAX_SHOTS in lib/image.js, which is where the reasoning
   for the number lives. Enforced again here because the client is not the
   thing being protected. */
const MAX_IMAGES = 4;
const KINDS = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/;

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  // One or several. `image` is still accepted so an older tab mid-session does
  // not break on deploy.
  const images = (Array.isArray(body.images) ? body.images : [body.image])
    .filter(Boolean).map(String).slice(0, MAX_IMAGES);
  const said = String(body.said || '').trim().slice(0, 600);

  if (!images.length) {
    return Response.json({ error: 'No picture came through.' }, { status: 400 });
  }
  if (!images.every((i) => KINDS.test(i))) {
    return Response.json({
      error: 'One of those files is not an image Wander can read. JPEG, PNG or WebP work.',
    }, { status: 400 });
  }
  if (images.reduce((n, i) => n + i.length, 0) > MAX_CHARS) {
    return Response.json({
      error: 'Those pictures are too large altogether. Try fewer, or smaller ones.',
    }, { status: 413 });
  }

  try {
    const out = await askJson({
      schemaName: 'picture_reading',
      schema: SCHEMA,
      system: SYSTEM,
      task: 'vision',
      maxTokens: 4000,
      user: [
        {
          type: 'text',
          text: `Read ${images.length === 1 ? 'this picture' : `these ${images.length} pictures`}`
            + ` for a trip.${said ? ` The traveller also said: "${said}"` : ''}`,
        },
        ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
      ],
    });

    const read = String(out.read || '').trim().slice(0, 120);

    if (!out.usable) {
      return Response.json({
        usable: false,
        read,
        /* The model's own sentence, because it is the only thing here that
           knows what was actually in the picture. The fallback is for the case
           where it decided no and then declined to say why. */
        error: String(out.reason || '').trim().slice(0, 300)
          || `I could not find a place in ${images.length === 1 ? 'that picture' : 'those pictures'}. `
            + 'A photo of somewhere recognisable, or of a written list of places, works best.',
        code: 'unreadable',
      }, { status: 422 });
    }

    const brief = String(out.brief || '').trim().slice(0, 6000);
    if (!brief) {
      return Response.json({
        usable: false,
        read,
        error: `I could see ${images.length === 1 ? 'the picture' : 'the pictures'} `
          + 'but could not get a trip out of it.',
        code: 'unreadable',
      }, { status: 422 });
    }

    return Response.json({ usable: true, read, brief });
  } catch (e) {
    return aiFailure(e, 'vision');
  }
}
