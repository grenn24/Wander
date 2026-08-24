import {
  aiFailure,
  askJson, aiConfigured, notConfigured, AI_CATEGORIES, cleanCategory, cleanTime,
} from '@/lib/ai';

export const runtime = 'nodejs';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['activities'],
  properties: {
    activities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'start_time', 'category', 'location', 'cost', 'notes'],
        properties: {
          title: { type: 'string' },
          start_time: { type: ['string', 'null'], description: '24h HH:MM, or null' },
          category: { type: 'string', enum: AI_CATEGORIES },
          location: { type: 'string', description: 'Real, searchable place name, or blank' },
          cost: { type: 'number' },
          notes: { type: 'string', description: 'Why it is worth doing, briefly' },
        },
      },
    },
  },
};

const NEWLINE = '\n';

const SYSTEM = `You fill in one day of an existing travel itinerary.

Rules:
- Suggest 2 to 4 activities that fit around what is already planned that day,
  without repeating anything already there.
- Stay near the day's existing stops. If the day is empty, stay near the trip's
  destination.
- "location" must be a real place name a map search would find, or blank.
- Times in 24-hour HH:MM, and only where the timing genuinely matters. Do not
  collide with the times already taken.
- Costs are per person in the trip currency, 0 when free.
- Some of the day may already be spoken for by things outside this trip —
  meetings, calls, a flight somebody else booked. Plan around them: do not put
  anything in those hours, and if the free stretch is short, suggest less
  rather than suggesting something that will not fit.`;

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const destination = String(body.destination || '').slice(0, 200);
  const currency = String(body.currency || 'SGD').slice(0, 8);
  const dayLabel = String(body.dayLabel || '').slice(0, 60);
  const existing = (Array.isArray(body.existing) ? body.existing : [])
    .slice(0, 20)
    .map((a) => `- ${a.start_time ? `${a.start_time} ` : ''}${a.title}${a.location ? ` (${a.location})` : ''}`)
    .join('\n');
  const note = String(body.note || '').slice(0, 500);
  const busy = (Array.isArray(body.busy) ? body.busy : []).slice(0, 20).map((e) => {
    const when = e && e.allDay
      ? 'all day'
      : `${String(e && e.start || '').slice(11, 16)}-${String(e && e.end || '').slice(11, 16)}`;
    return `${when} ${String((e && e.title) || 'Busy').slice(0, 80)}`;
  }).join(NEWLINE);

  try {
    const out = await askJson({
      schemaName: 'day_suggestions',
      schema: SCHEMA,
      system: SYSTEM,
      task: 'suggest',
      user: `Trip destination: ${destination || 'unspecified'}\n`
        + `Currency: ${currency}\n`
        + `Day: ${dayLabel}\n`
        + `Already planned that day:\n${existing || '(nothing yet)'}\n`
        + (busy ? `\nAlready committed elsewhere that day:\n${busy}\n` : '')
        + (note ? `\nThe traveller asks: ${note}` : ''),
      maxTokens: 8000,
    });

    const activities = (Array.isArray(out.activities) ? out.activities : []).slice(0, 6).map((a) => ({
      title: String(a.title || '').trim().slice(0, 200) || 'Untitled',
      start_time: cleanTime(a.start_time),
      category: cleanCategory(a.category),
      location: String(a.location || '').trim().slice(0, 300),
      cost: Number.isFinite(Number(a.cost)) ? Math.max(0, Number(a.cost)) : 0,
      notes: String(a.notes || '').trim().slice(0, 1000),
    }));

    return Response.json({ activities });
  } catch (e) {
    return aiFailure(e, 'suggest');
  }
}
