import { aiFailure, askJson, aiConfigured, notConfigured, PACKING_GROUPS } from '@/lib/ai';

export const runtime = 'nodejs';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'category', 'qty'],
        properties: {
          label: { type: 'string' },
          category: { type: 'string', enum: PACKING_GROUPS },
          qty: { type: 'integer', description: '1 unless several are genuinely needed' },
        },
      },
    },
  },
};

const SYSTEM = `You write packing lists for a specific trip.

Rules:
- Tailor it: the destination's weather in that season, the length of the trip,
  and what the itinerary actually involves. A hiking day and a city trip pack
  differently.
- 15 to 25 items. Practical things people forget, not padding.
- Quantities reflect the trip length for things like shirts and socks.
- Skip anything already listed as packed.
- No duplicates, and keep labels short.`;

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const destination = String(body.destination || '').slice(0, 200);
  const dates = String(body.dates || '').slice(0, 80);
  const days = Math.min(60, Math.max(1, Number(body.days) || 1));
  const existing = (Array.isArray(body.existing) ? body.existing : [])
    .slice(0, 60).map((s) => String(s).slice(0, 60)).join(', ');
  const themes = (Array.isArray(body.themes) ? body.themes : [])
    .slice(0, 30).map((s) => String(s).slice(0, 80)).join('; ');

  try {
    const out = await askJson({
      schemaName: 'packing_list',
      schema: SCHEMA,
      system: SYSTEM,
      task: 'packing',
      user: `Destination: ${destination || 'unspecified'}\n`
        + `Dates: ${dates || 'unspecified'} (${days} day${days === 1 ? '' : 's'})\n`
        + `The itinerary involves: ${themes || 'general travel'}\n`
        + `Already on the list: ${existing || '(nothing)'}`,
      maxTokens: 8000,
    });

    const seen = new Set();
    const items = (Array.isArray(out.items) ? out.items : []).reduce((acc, i) => {
      const label = String(i.label || '').trim().slice(0, 80);
      const key = label.toLowerCase();
      if (!label || seen.has(key) || acc.length >= 30) return acc;
      seen.add(key);
      acc.push({
        label,
        category: PACKING_GROUPS.includes(i.category) ? i.category : 'general',
        qty: Math.min(20, Math.max(1, Number(i.qty) || 1)),
      });
      return acc;
    }, []);

    return Response.json({ items });
  } catch (e) {
    return aiFailure(e, 'packing');
  }
}
