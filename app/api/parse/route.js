import {
  askJson, aiConfigured, notConfigured, AI_CATEGORIES, cleanCategory, cleanTime,
} from '@/lib/ai';

export const runtime = 'nodejs';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['understood', 'question', 'activity'],
  properties: {
    understood: {
      type: 'boolean',
      description: 'False only when a single short question would genuinely change the result.',
    },
    question: {
      type: 'string',
      description: 'One short question to ask, when understood is false. Otherwise blank.',
    },
    activity: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['title', 'start_time', 'end_time', 'category', 'location', 'cost', 'notes'],
      properties: {
        title: { type: 'string', description: 'Short, what it is. No times in the title.' },
        start_time: { type: ['string', 'null'], description: '24h HH:MM, or null' },
        end_time: { type: ['string', 'null'], description: '24h HH:MM, or null' },
        category: { type: 'string', enum: AI_CATEGORIES },
        location: {
          type: 'string',
          description: 'A real, searchable place name. Blank rather than invented.',
        },
        cost: { type: 'number', description: 'Per person in the trip currency, 0 if unknown' },
        notes: { type: 'string', description: 'Anything said that does not fit the other fields' },
      },
    },
  },
};

const SYSTEM = `You turn one line of a traveller's shorthand into a single itinerary entry.

Interpret naturally:
- "dinner at 7" is food at 19:00. "morning" is about 09:00, "afternoon" 14:00,
  "evening" 19:00. Leave the time null when none is implied.
- "2h" or "for a couple of hours" sets an end time relative to the start.
- Prices like "about 30 quid" or "2000 yen" become the number alone.
- Put a place in "location" only if it is a real, searchable name. If they say
  "that ramen place near the hotel", leave location blank and keep the phrase in
  notes rather than inventing somewhere.
- Use the trip's destination to disambiguate a bare place name.

Only set understood to false when one short question would genuinely change what
gets created — an ambiguous place with two obvious readings, or a time that
could be morning or evening in a way that matters. Never ask about anything you
can reasonably default, and never ask more than one question.`;

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const text = String(body.text || '').trim().slice(0, 500);
  if (!text) return Response.json({ error: 'Nothing to read.' }, { status: 400 });

  const destination = String(body.destination || '').slice(0, 200);
  const currency = String(body.currency || 'SGD').slice(0, 8);
  const dayLabel = String(body.dayLabel || '').slice(0, 60);
  const answer = String(body.answer || '').slice(0, 300);
  const existing = (Array.isArray(body.existing) ? body.existing : [])
    .slice(0, 15)
    .map((a) => `- ${a.start_time ? `${a.start_time} ` : ''}${a.title}`)
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
      schemaName: 'parsed_activity',
      schema: SCHEMA,
      system: SYSTEM,
      task: 'parse',
      user: prompt,
      maxTokens: 2000,
    });

    if (!out.understood && out.question) {
      return Response.json({ understood: false, question: String(out.question).slice(0, 200) });
    }

    const a = out.activity || {};
    return Response.json({
      understood: true,
      activity: {
        title: String(a.title || '').trim().slice(0, 200) || text.slice(0, 80),
        start_time: cleanTime(a.start_time),
        end_time: cleanTime(a.end_time),
        category: cleanCategory(a.category),
        location: String(a.location || '').trim().slice(0, 300),
        cost: Number.isFinite(Number(a.cost)) ? Math.max(0, Number(a.cost)) : 0,
        notes: String(a.notes || '').trim().slice(0, 1000),
      },
    });
  } catch (e) {
    return Response.json({ error: e.message || 'Could not read that.' }, { status: 502 });
  }
}
