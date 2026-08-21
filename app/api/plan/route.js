import {
  aiConfigured, notConfigured, aiModel, aiEffort, AI_CATEGORIES, cleanCategory, cleanTime,
} from '@/lib/ai';
import { parsePartial } from '@/lib/partialJson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  in the summary.
- Write the trip name, destination and summary first, then the days in order.`;

function cleanActivity(a) {
  return {
    title: String(a.title || '').trim().slice(0, 200) || 'Untitled',
    start_time: cleanTime(a.start_time),
    category: cleanCategory(a.category),
    location: String(a.location || '').trim().slice(0, 300),
    cost: Number.isFinite(Number(a.cost)) ? Math.max(0, Number(a.cost)) : 0,
    notes: String(a.notes || '').trim().slice(0, 1000),
  };
}

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

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: aiModel('plan'),
        stream: true,
        max_completion_tokens: 16000,
        ...(aiEffort('plan') ? { reasoning_effort: aiEffort('plan') } : {}),
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Today is ${today || 'unknown'}. Plan this trip:\n\n${prompt}` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'trip_plan', strict: true, schema: SCHEMA },
        },
      }),
    });
  } catch (e) {
    return Response.json({ error: 'Could not reach OpenAI.' }, { status: 502 });
  }

  if (!upstream.ok) {
    let detail = '';
    try {
      const body = await upstream.json();
      detail = (body.error && body.error.message) || '';
    } catch (e) { /* non-JSON body */ }
    let msg = detail || `OpenAI returned ${upstream.status}.`;
    if (upstream.status === 401) msg = 'OpenAI rejected the API key. Check OPENAI_API_KEY.';
    else if (upstream.status === 429) msg = 'OpenAI is rate limiting or the account is out of quota.';
    else if (/model/i.test(detail) && /(not exist|not found|access)/i.test(detail)) {
      msg = `Your account cannot use "${aiModel('plan')}". `
        + 'Set OPENAI_MODEL to one you do have.';
    }
    return Response.json({ error: msg }, { status: 502 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));

      // What the client already knows, so each event carries only what is new.
      let sentMeta = '';
      const sentThemes = new Map();
      const sentCounts = new Map();
      let text = '';

      const flush = () => {
        const partial = parsePartial(text);
        if (!partial || typeof partial !== 'object') return;

        const meta = {
          name: typeof partial.name === 'string' ? partial.name : '',
          destination: typeof partial.destination === 'string' ? partial.destination : '',
          currency: typeof partial.currency === 'string' ? partial.currency : '',
          duration_days: Number(partial.duration_days) || 0,
          summary: typeof partial.summary === 'string' ? partial.summary : '',
        };
        const metaKey = JSON.stringify(meta);
        if (metaKey !== sentMeta) { sentMeta = metaKey; send({ t: 'meta', ...meta }); }

        (Array.isArray(partial.days) ? partial.days : []).forEach((d) => {
          if (!d || typeof d !== 'object') return;
          const idx = Number(d.day_index);
          if (!Number.isInteger(idx) || idx < 1) return;

          const theme = typeof d.theme === 'string' ? d.theme : '';
          if (sentThemes.get(idx) !== theme) {
            sentThemes.set(idx, theme);
            send({ t: 'day', i: idx, theme });
          }

          const acts = Array.isArray(d.activities) ? d.activities : [];
          const already = sentCounts.get(idx) || 0;
          for (let k = already; k < acts.length; k += 1) {
            // parsePartial only ever yields complete objects, so this is whole.
            send({ t: 'act', d: idx, a: cleanActivity(acts[k]) });
          }
          if (acts.length > already) sentCounts.set(idx, acts.length);
        });
      };

      try {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const evt = JSON.parse(payload);
              const delta = evt.choices && evt.choices[0] && evt.choices[0].delta;
              if (delta && typeof delta.content === 'string') text += delta.content;
            } catch (e) { /* keep reading; one bad frame is not fatal */ }
          }
          flush();
        }

        if (!text.trim()) {
          // Same trap as the blocking routes: the budget can be spent entirely
          // on reasoning, leaving no itinerary behind.
          throw new Error('The model produced no itinerary — it may have spent its '
            + 'budget reasoning. Try again, or lower the plan effort in TASKS.');
        }
        const final = JSON.parse(text);
        const duration = Math.min(30, Math.max(1, Number(final.duration_days) || 1));
        const days = (Array.isArray(final.days) ? final.days : [])
          .filter((d) => Number(d.day_index) >= 1 && Number(d.day_index) <= duration)
          .map((d) => ({
            day_index: Number(d.day_index),
            theme: String(d.theme || ''),
            activities: (Array.isArray(d.activities) ? d.activities : []).slice(0, 8).map(cleanActivity),
          }));

        send({
          t: 'done',
          plan: {
            name: String(final.name || '').trim().slice(0, 120) || 'New trip',
            destination: String(final.destination || '').trim().slice(0, 200),
            currency: /^[A-Z]{3}$/.test(final.currency) ? final.currency : 'SGD',
            start_date: /^\d{4}-\d{2}-\d{2}$/.test(final.start_date || '') ? final.start_date : null,
            duration_days: duration,
            summary: String(final.summary || '').trim().slice(0, 500),
            days,
          },
        });
      } catch (e) {
        send({ t: 'error', error: e.message || 'The plan did not finish.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
