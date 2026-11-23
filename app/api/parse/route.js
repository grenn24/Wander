import {
  aiFailure,
  askJson, aiConfigured, notConfigured, AI_CATEGORIES, cleanCategory, cleanTime,
} from '@/lib/ai';
import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

/** Most a single line can sensibly name. */
const MAX_ENTRIES = 8;

const ACTIVITY = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'start_time', 'end_time', 'category', 'location', 'cost', 'notes'],
  properties: {
    title: {
      type: 'string',
      description: 'The one place this entry is, by its own name and branch: '
        + '"Ralph Lauren Ginza", "MoMA Design Store". Never two places joined by '
        + '"and". No times.',
    },
    start_time: { type: ['string', 'null'], description: '24h HH:MM, or null' },
    end_time: { type: ['string', 'null'], description: '24h HH:MM, or null' },
    category: { type: 'string', enum: AI_CATEGORIES },
    location: {
      type: 'string',
      description: 'What to type into Google Maps to land on this exact venue: its name, '
        + 'the building or store it is inside, the district and the city — '
        + '"MoMA Design Store, Ginza Loft, Ginza, Tokyo". Never only a district or a '
        + 'city for a specific venue. Blank rather than invented.',
    },
    cost: { type: 'number', description: 'Per person in the trip currency, 0 if unknown' },
    notes: {
      type: 'string',
      description: 'Only what they said that fits no other field. Never the request '
        + 'repeated back. Blank is fine.',
    },
  },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['understood', 'question', 'activities'],
  properties: {
    understood: {
      type: 'boolean',
      description: 'False only when a single short question would genuinely change the result.',
    },
    question: {
      type: 'string',
      description: 'One short question to ask, when understood is false. Otherwise blank.',
    },
    activities: {
      type: 'array',
      description: 'One entry per place, in the order they would be visited. '
        + 'Empty when understood is false.',
      items: ACTIVITY,
    },
  },
};

const SYSTEM = `You turn one line of a traveller's shorthand into itinerary entries.

One place, one entry. Every entry is a stop on a map, and a stop that names
two shops has nowhere to be:
- "add ralph lauren and moma design store ginza loft" is two entries, "Ralph
  Lauren Ginza" and "MoMA Design Store", each at its own venue. Never one entry
  called "Shopping at Ralph Lauren and MoMA Design Store".
- Split places, not words. "Dinner and drinks at Bar Benfiddich" is one place.
  "MoMA Design Store Ginza Loft" is one shop inside one building, not two.
- The title is the place's own name as its sign or Google Maps shows it, with
  the branch when there are several ("Ichiran Shibuya"). Add a word for what
  happens there only when the name alone would not say it ("Dinner at Sushi
  Saito"). No times in the title.

Be exact about where:
- "location" is what you would type into Google Maps to land at that door: the
  venue's name, then the building or store it is inside, the district and the
  city — "Ralph Lauren Ginza, Ginza, Chuo City, Tokyo". The app looks up the
  street address from it, so an exact name matters more than a street number.
  Write a street address only when they gave one.
- For a chain, choose the branch nearest what they said: the district they
  named, or that day's other stops.
- Never put only a district or a city in "location" when the entry is a
  specific venue. If they say "that ramen place near the hotel", leave location
  blank and keep the phrase in notes rather than inventing somewhere.
- Use the trip's destination to disambiguate a bare place name.

When:
- "dinner at 7" is food at 19:00. "morning" is about 09:00, "afternoon" 14:00,
  "evening" 19:00. Leave the time null when none is implied.
- When they add to something already planned — "to my Ginza shopping", "after
  lunch", "before the museum" — find it in the day's list by its name or place
  and put the new entries inside that stretch, one after another, each with a
  realistic length and in an order that makes sense on foot.
- "2h" or "for a couple of hours" sets an end time relative to the start.

Everything else:
- Prices like "about 30 quid" or "2000 yen" become the number alone.
- Notes hold only what they said that fits no other field. "Add to the Ginza
  shopping portion" is an instruction, not a note.

Only set understood to false when one short question would genuinely change
what gets created — an ambiguous place with two obvious readings, or a time
that could be morning or evening in a way that matters. Never ask about
anything you can reasonably default, and never ask more than one question.`;

/** "10:00:00" from Postgres, "10:00" from a draft: the same clock either way. */
function clock(value) {
  return cleanTime(value) || '';
}

function entry(a, fallback) {
  return {
    title: String(a.title || '').trim().slice(0, 200) || fallback,
    start_time: cleanTime(a.start_time),
    end_time: cleanTime(a.end_time),
    category: cleanCategory(a.category),
    location: String(a.location || '').trim().slice(0, 300),
    cost: Number.isFinite(Number(a.cost)) ? Math.max(0, Number(a.cost)) : 0,
    notes: String(a.notes || '').trim().slice(0, 1000),
  };
}

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();
  // Every answer is a paid model call: only for someone signed in.
  if (!(await userFromRequest(req))) return notSignedIn();

  let body;
  try {
    body = (await req.json()) || {};
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const text = String(body.text || '').trim().slice(0, 500);
  if (!text) return Response.json({ error: 'Nothing to read.' }, { status: 400 });

  const destination = String(body.destination || '').slice(0, 200);
  const currency = String(body.currency || 'SGD').slice(0, 8);
  const dayLabel = String(body.dayLabel || '').slice(0, 60);
  const answer = String(body.answer || '').slice(0, 300);
  /* The day's stops with their whole stretch and their place, so "add these to
     my Ginza shopping" can find the Ginza stop and fit inside it. */
  const existing = (Array.isArray(body.existing) ? body.existing : [])
    .filter((a) => a && typeof a === 'object')
    .slice(0, 15)
    .map((a) => {
      const start = clock(a.start_time);
      const end = clock(a.end_time);
      const when = start ? `${start}${end ? `–${end}` : ''} ` : '';
      const where = String(a.location || '').trim().slice(0, 160);
      return `- ${when}${String(a.title || '').slice(0, 160)}${where ? ` @ ${where}` : ''}`;
    })
    .join('\n');

  const prompt = [
    `Trip destination: ${destination || 'unspecified'}`,
    `Currency: ${currency}`,
    `Adding to: ${dayLabel}`,
    'Already that day:',
    existing || '(nothing yet)',
    '',
    `They wrote: "${text}"`,
    answer ? `They then clarified: "${answer}"` : '',
  ].join('\n');

  try {
    const out = await askJson({
      schemaName: 'parsed_activities',
      schema: SCHEMA,
      system: SYSTEM,
      task: 'parse',
      user: prompt,
      maxTokens: 4000,
    });

    if (!out.understood && out.question) {
      return Response.json({ understood: false, question: String(out.question).slice(0, 200) });
    }

    const fallback = text.slice(0, 80);
    const activities = (Array.isArray(out.activities) ? out.activities : [])
      .filter((a) => a && typeof a === 'object')
      .slice(0, MAX_ENTRIES)
      .map((a) => entry(a, fallback));
    if (!activities.length) activities.push(entry({}, fallback));

    return Response.json({
      understood: true,
      activities,
      // A tab still running the last build reads one entry from here.
      activity: activities[0],
    });
  } catch (e) {
    return aiFailure(e, 'parse');
  }
}
