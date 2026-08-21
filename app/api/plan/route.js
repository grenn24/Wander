import {
  askJson, aiConfigured, notConfigured, AI_CATEGORIES, cleanCategory, cleanTime,
} from '@/lib/ai';

export const runtime = 'nodejs';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'destination', 'currency', 'start_date', 'duration_days', 'summary', 'days'],
  properties: {
    name: { type: 'string', description: 'Short trip name, e.g. "Japan, December"' },
    destination: { type: 'string', description: 'Places visited, e.g. "Tokyo & Kyoto"' },
    currency: { type: 'string', description: 'ISO 4217 code sensible for the destination' },
    start_date: {
      type: ['string', 'null'],
      description: 'YYYY-MM-DD. Null only if the request gives no usable timing at all.',
    },
    duration_days: { type: 'integer', description: 'Whole days, 1 to 30' },
    summary: { type: 'string', description: 'One sentence on the shape of the trip' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day_index', 'theme', 'activities'],
        properties: {
          day_index: { type: 'integer', description: '1-based' },
          theme: { type: 'string', description: 'A few words on the day' },
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
                location: {
                  type: 'string',
                  description: 'A real, searchable place name. Blank if there is no specific place.',
                },
                cost: { type: 'number', description: 'Per person, in the trip currency. 0 if free.' },
                notes: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You plan travel itineraries that a real traveller could actually follow.

Rules:
- Keep each day realistic: 3 to 5 activities, geographically sensible, no zig-zagging
  across a city and back.
- "location" must be a real place name that a map search would find — "Senso-ji,
  Asakusa, Tokyo", not "a nice temple". Leave it blank rather than invent one.
- Put times in 24-hour HH:MM. Use them for things that are genuinely time-bound
  (opening hours, transport, bookings) and leave others null.
- Costs are per person in the trip currency, as plain numbers. Use 0 when free.
- Include travel between cities as a transport activity on the day it happens.
- If the request names no dates, choose a sensible near-future start and say so
  in the summary.`;

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();

  let prompt = '';
  let today = '';
  try {
    const body = await req.json();
    prompt = String(body.prompt || '').trim().slice(0, 2000);
    today = String(body.today || '').slice(0, 10);
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  if (!prompt) return Response.json({ error: 'Describe the trip you want.' }, { status: 400 });

  try {
    const plan = await askJson({
      schemaName: 'trip_plan',
      schema: SCHEMA,
      system: SYSTEM,
      user: `Today is ${today || 'unknown'}. Plan this trip:\n\n${prompt}`,
      maxTokens: 8000,
    });

    // Never trust the shape straight into the database.
    const duration = Math.min(30, Math.max(1, Number(plan.duration_days) || 1));
    const days = (Array.isArray(plan.days) ? plan.days : [])
      .filter((d) => Number(d.day_index) >= 1 && Number(d.day_index) <= duration)
      .map((d) => ({
        day_index: Number(d.day_index),
        theme: String(d.theme || ''),
        activities: (Array.isArray(d.activities) ? d.activities : []).slice(0, 8).map((a) => ({
          title: String(a.title || '').trim().slice(0, 200) || 'Untitled',
          start_time: cleanTime(a.start_time),
          category: cleanCategory(a.category),
          location: String(a.location || '').trim().slice(0, 300),
          cost: Number.isFinite(Number(a.cost)) ? Math.max(0, Number(a.cost)) : 0,
          notes: String(a.notes || '').trim().slice(0, 1000),
        })),
      }));

    return Response.json({
      name: String(plan.name || '').trim().slice(0, 120) || 'New trip',
      destination: String(plan.destination || '').trim().slice(0, 200),
      currency: /^[A-Z]{3}$/.test(plan.currency) ? plan.currency : 'SGD',
      start_date: /^\d{4}-\d{2}-\d{2}$/.test(plan.start_date || '') ? plan.start_date : null,
      duration_days: duration,
      summary: String(plan.summary || '').trim().slice(0, 500),
      days,
    });
  } catch (e) {
    return Response.json({ error: e.message || 'Planning failed.' }, { status: 502 });
  }
}
