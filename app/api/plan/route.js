import {
  aiConfigured, notConfigured, aiFailure, aiModel, aiEffort, AI_CATEGORIES,
  cleanCategory, cleanTime, askJson,
} from '@/lib/ai';
import { parsePartial } from '@/lib/partialJson';
import { userFromRequest } from '@/lib/supabaseServer';
import { listEvents, connection } from '@/lib/googleCal';

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
- Write the trip name, destination and summary first, then the days in order.

You may be given "Already in their calendar" — real entries from the
traveller's own calendar on these dates, each with whatever address and notes
they wrote on it. These are facts, not suggestions:
- Copy them, do not describe them. The title is theirs, character for
  character: "Joseph's Wedding" is the title, not "Joseph's Wedding (calendar
  item)", not "Wedding (morning)", not "Joseph's Wedding — see calendar". Add
  nothing in brackets. Annotate nothing. If you find yourself explaining where
  the entry came from, stop: they know, they wrote it.
- The date and the time are theirs too. An entry at 09:30 on the 7th is an
  activity at 09:30 on the 7th, even if the day would flow better with it
  somewhere else. Move your own suggestions around it; never move it.
- The address is theirs. Never replace a real street address with a district
  or a city, and never write "see calendar" or "details in calendar" — you have
  the details, so put them in the notes.
- Never invent a second activity for something already in that list. If they
  have "Stay at Ascott Star KLCC, 1 Jalan Yap Kwan Seng" then the check-in is
  that hotel at that address — do not also add a generic "check in to a hotel
  in the centre". One thing happened; it gets one activity.
- A multi-day all-day entry is usually where they are staying. Use it for the
  check-in on the first day and the check-out on the last, with its real
  address on both, and plan the days around that part of the city.
- Give them the right category: a hotel is lodging, a flight or a transfer is
  transport, a meal is food. "other" is for what genuinely fits nowhere.
- Plan around the times they are busy. Do not schedule anything on top of
  them.`;

/**
 * Put back what the traveller actually wrote.
 *
 * The instructions say to copy a calendar entry verbatim, and the instructions
 * are not enough on their own: it has already come back as "Joseph's Wedding
 * (calendar item)" once, and a title someone did not write is a title they
 * cannot search for. So where a planned activity is recognisably one of their
 * entries, the name and the address are taken from the entry rather than from
 * whatever was written about it.
 *
 * Containment of the whole title, not a fuzzy match: "Joseph's Wedding
 * (calendar item)" contains "Joseph's Wedding", and nothing else in a trip
 * plausibly does.
 */
function corrector(events) {
  const known = (events || [])
    .map((e) => ({
      title: String(e.title || '').trim(),
      low: String(e.title || '').trim().toLowerCase(),
      where: String(e.where || '').trim(),
    }))
    // Short titles like "Gym" would match half an itinerary.
    .filter((e) => e.low.length >= 5);

  if (!known.length) return (a) => a;
  return (a) => {
    const t = String(a.title || '').toLowerCase();
    const hit = known.find((e) => t.includes(e.low));
    if (!hit || a.title === hit.title) return a;
    return { ...a, title: hit.title, location: hit.where || a.location };
  };
}

function cleanActivity(a, fix) {
  const it = fix ? fix(a) : a;
  return {
    title: String(it.title || '').trim().slice(0, 200) || 'Untitled',
    start_time: cleanTime(it.start_time),
    category: cleanCategory(it.category),
    location: String(it.location || '').trim().slice(0, 300),
    cost: Number.isFinite(Number(it.cost)) ? Math.max(0, Number(it.cost)) : 0,
    notes: String(it.notes || '').trim().slice(0, 1000),
  };
}

/**
 * Which dates this request is about, before anything is planned.
 *
 * The calendar can only be read for a range, and the range is whatever the
 * planner is about to decide — so it has to be decided twice, cheaply first.
 * One sentence in, two fields out, at minimal effort; a second or so in front
 * of a plan that takes a minute.
 */
const WHEN = {
  type: 'object',
  additionalProperties: false,
  required: ['start_date', 'duration_days'],
  properties: {
    start_date: {
      type: ['string', 'null'],
      description: 'YYYY-MM-DD. Null if the request gives nothing to go on at all.',
    },
    duration_days: { type: 'integer', description: 'Whole days, 1 to 30' },
  },
};

/**
 * What the traveller already has on, during the trip they are asking for.
 *
 * Returns nothing at all unless they have connected a calendar — no request is
 * made, and the planner is told nothing. Everything here is best-effort: a trip
 * planned without the calendar is the behaviour this has always had, and is a
 * far better outcome than a failure.
 */
async function theirCalendar(req, prompt, today) {
  try {
    const user = await userFromRequest(req);
    if (!user) return null;
    if (!(await connection(user.id))) return null;

    const when = await askJson({
      schemaName: 'trip_dates',
      schema: WHEN,
      system: 'You work out which dates a travel request is about. Today is '
        + `${today || 'unknown'}. Answer with the start date and how many days.`,
      task: 'when',
      maxTokens: 600,
      user: prompt,
    });
    if (!when || !when.start_date) return null;

    const days = Math.min(30, Math.max(1, Number(when.duration_days) || 1));
    const end = new Date(`${when.start_date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + days - 1);

    const events = await listEvents(
      user.id,
      new Date(`${when.start_date}T00:00:00Z`).toISOString(),
      new Date(`${end.toISOString().slice(0, 10)}T23:59:59Z`).toISOString(),
    );
    if (!events.length) return null;
    return { from: when.start_date, days, events };
  } catch (e) {
    console.error('[plan] calendar lookup skipped:', e.message);
    return null;
  }
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

  const mine = await theirCalendar(req, prompt, today);
  const calendarBlock = mine ? [
    '',
    'Already in their calendar on these dates — use these exactly, and do not',
    'invent a second activity for anything in this list:',
    ...mine.events.map((e) => {
      const day = String(e.start).slice(0, 10);
      const last = String(e.end || '').slice(0, 10);
      const span = e.allDay && last && last > day ? ` until ${last}` : '';
      const when2 = e.allDay ? 'all day' : String(e.start).slice(11, 16);
      return [
        `- ${day}${span} ${when2} | ${e.title}`,
        e.where ? `  address: ${e.where}` : '',
        e.details ? `  notes: ${e.details}` : '',
      ].filter(Boolean).join('\n');
    }),
    '',
    `Unless the request clearly says otherwise, start the trip on ${mine.from}`
      + ` and run it for ${mine.days} day${mine.days === 1 ? '' : 's'}.`,
  ].join('\n') : '';

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
        max_completion_tokens: 32000,
        ...(aiEffort('plan') ? { reasoning_effort: aiEffort('plan') } : {}),
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Today is ${today || 'unknown'}. Plan this trip:`
              + `\n\n${prompt}${calendarBlock}`,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'trip_plan', strict: true, schema: SCHEMA },
        },
      }),
    });
  } catch (e) {
    return aiFailure(e, 'plan');
  }

  if (!upstream.ok) {
    let detail = '';
    try {
      const body = await upstream.json();
      detail = (body.error && body.error.message) || '';
    } catch (e) { /* non-JSON body */ }
    // Named in the log, where it is useful; never in the reply, where it is not.
    return aiFailure(
      new Error(`${upstream.status} ${detail || 'no detail'} (model ${aiModel('plan')})`),
      'plan',
    );
  }

  // Applied to every activity, streamed and final alike, so the preview and
  // the saved trip cannot disagree about what something is called.
  const fix = corrector(mine && mine.events);

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
            send({ t: 'act', d: idx, a: cleanActivity(acts[k], fix) });
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
            activities: (Array.isArray(d.activities) ? d.activities : []).slice(0, 8).map((x) => cleanActivity(x, fix)),
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
        console.error('[ai] plan stream failed:', (e && e.message) || e);
        send({ t: 'error', error: 'Something went wrong on our end. Please try again.' });
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
