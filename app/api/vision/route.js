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

const SYSTEM = `You read a photograph and decide whether a trip can be planned from it.

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
- "read" is always filled in, including when the answer is no.`;

/* Big enough for a photograph, small enough that nobody uploads a RAW file
   through it. The client shrinks before sending; this is the backstop. */
const MAX_CHARS = 3_000_000;
const KINDS = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/;

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const image = String(body.image || '');
  const said = String(body.said || '').trim().slice(0, 600);

  if (!image) {
    return Response.json({ error: 'No picture came through.' }, { status: 400 });
  }
  if (!KINDS.test(image)) {
    return Response.json({
      error: 'That file is not an image Wander can read. JPEG, PNG or WebP work.',
    }, { status: 400 });
  }
  if (image.length > MAX_CHARS) {
    return Response.json({
      error: 'That picture is too large. Try one under about 2 MB.',
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
          text: said
            ? `Read this picture for a trip. The traveller also said: "${said}"`
            : 'Read this picture for a trip.',
        },
        { type: 'image_url', image_url: { url: image, detail: 'high' } },
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
          || 'I could not find a place in that picture. A photo of somewhere '
            + 'recognisable, or of a written list of places, works best.',
        code: 'unreadable',
      }, { status: 422 });
    }

    const brief = String(out.brief || '').trim().slice(0, 4000);
    if (!brief) {
      return Response.json({
        usable: false,
        read,
        error: 'I could see the picture but could not get a trip out of it.',
        code: 'unreadable',
      }, { status: 422 });
    }

    return Response.json({ usable: true, read, brief });
  } catch (e) {
    return aiFailure(e, 'vision');
  }
}
