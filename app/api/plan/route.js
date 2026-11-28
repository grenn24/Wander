import {
  aiConfigured, notConfigured, aiFailure, aiModel, aiEffort, AI_CATEGORIES,
  cleanCategory, cleanTime, askJson,
} from '@/lib/ai';
import { parsePartial } from '@/lib/partialJson';
import { relayStream } from '@/lib/aiStream';
import {
  readResume, resumeInstruction, BEAT_MS, PLAN_FIRST_MS, PLAN_QUIET_MS,
} from '@/lib/planResume';
import { publicAgentText } from '@/lib/agentText';
import { validZone } from '@/public/trip-time';
import { TRANSPORT } from '@/lib/transport';
import { LODGING_KEYS, cleanLodging } from '@/lib/lodging';
import { after } from 'next/server';
import { userFromRequest, notSignedIn, asUser } from '@/lib/supabaseServer';
import { openDraft, draftWriter } from '@/lib/planDraft';
import { listEvents, connection } from '@/lib/googleCal';
import { hasExclusiveScope } from '@/lib/planScope';
import { cleanFixed, fixedBlock, isHomeFlight } from '@/lib/flightPlan';
import { homeOf } from '@/lib/home';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/*
 * A whole itinerary on the better model is a minute or two of work. Left to a
 * host's default the request is cut off partway and the reader sees a dropped
 * connection rather than a deadline.
 */
export const maxDuration = 300;

/* flight, train, bus, ferry, car, transfer — the app's own list, so a new one
   is offered to the planner the moment it exists rather than a year later. */
const TRANSPORT_IDS = TRANSPORT.map((t) => t.id);

/*
 * Every field the app can actually keep about a guide, taken from the same
 * table the editor builds its form from.
 *
 * This is the fix for a whole class of complaint. The planner used to be given
 * six fields — a title, a time, a category, a place, a cost and a note — while
 * an activity can hold an end time, a booking reference, a flight number, a
 * gate and a seat. Everything it knew and had nowhere to put went into the
 * title instead, which is how a flight arrived called "Flight: SIN (T2) → KUL
 * (T1), MH 616 (confirmed)": five structured facts and an annotation, jammed
 * into the one box on offer. Give it the boxes and it stops writing prose.
 */
const DETAIL_KEYS = [...new Set([...TRANSPORT.flatMap((t) => t.fields.map((f) => f.k)), ...LODGING_KEYS])];

// Flight clocks belong to their endpoints, never to the browser.
const DETAILS = {
  type: 'object',
  additionalProperties: false,
  required: DETAIL_KEYS,
  properties: DETAIL_KEYS.reduce((o, k) => ({ ...o, [k]: { type: ['string', 'null'] } }), {}),
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'destination', 'timezone', 'currency', 'start_date', 'duration_days', 'summary', 'days'],
  properties: {
    name: { type: 'string', description: 'Short trip name, e.g. "Japan, December"' },
    destination: { type: 'string', description: 'Places visited, e.g. "Tokyo & Kyoto"' },
    timezone: { type: ['string', 'null'], description: 'IANA time zone of the main destination, e.g. Asia/Tokyo. Null if uncertain.' },
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
              required: [
                'title', 'start_time', 'end_time', 'category', 'subtype',
                'location', 'notes', 'cost', 'booking_ref', 'details', 'requested',
                'named_place',
              ],
              properties: {
                title: {
                  type: 'string',
                  description: 'A plain name for the thing, as a person would say it: '
                    + '"Flight to Kuala Lumpur", "Dinner at Jalan Alor", "Ralph Lauren Ginza". '
                    + 'One place per activity, never two joined by "and". Never a place to '
                    + 'put facts that have their own field below, and never an annotation '
                    + 'in brackets.',
                },
                start_time: { type: ['string', 'null'], description: '24h HH:MM, or null' },
                end_time: {
                  type: ['string', 'null'],
                  description: '24h HH:MM. When the thing is over — fill this in whenever '
                    + 'it can be reasonably judged, so the day shows real free time.',
                },
                category: { type: 'string', enum: AI_CATEGORIES },
                subtype: {
                  type: ['string', 'null'],
                  enum: [...TRANSPORT_IDS, null],
                  description: 'Only for transport, and only when you know which: a taxi or '
                    + 'a private car is "transfer", a hired car is "car". Null otherwise.',
                },
                location: {
                  type: 'string',
                  description: 'What to type into Google Maps to land on this exact venue: its '
                    + 'name, the building it is in, the district and the city — "Ralph Lauren '
                    + 'Ginza, Ginza, Chuo City, Tokyo". Never only a district or a city for a '
                    + 'specific venue. Blank if there is no specific place.',
                },
                notes: {
                  type: 'string',
                  description: 'Never empty. One or two sentences of what a traveller would '
                    + 'actually want to know before going: whether to book ahead, opening '
                    + 'hours or closing days if they matter, roughly how long it takes, '
                    + 'what to order, what to watch out for, how to get in. Say something '
                    + 'only someone who knew the place would say.',
                },
                cost: { type: 'number', description: 'Per person, in the trip currency. 0 if free.' },
                booking_ref: {
                  type: ['string', 'null'],
                  description: 'A confirmation or reference number, only if one is actually '
                    + 'known from the request or the calendar. Never invented.',
                },
                requested: {
                  type: 'boolean',
                  description: 'True only when this exact activity was requested by the traveller, '
                    + 'is an explicitly requested guide, or is an existing calendar commitment. '
                    + 'False for suggested meals, nearby attractions, rest, check-ins, transfers, '
                    + 'and other filler that the traveller did not name.',
                },
                named_place: {
                  type: 'boolean',
                  description: 'True only when the traveller named this venue themselves: in '
                    + 'their words, their answers, a picture, a requested guide or a calendar '
                    + 'entry. False when you chose the venue, even for something they asked '
                    + 'for: "see the aurora" names no camp, "ramen in Tokyo" names no shop.',
                },
                details: DETAILS,
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
- The traveller's constraints override every default below. Words such as
  "only", "exclusively", "nothing else", and "no other activities" are hard
  limits. Include the named places and explicitly requested guides only.
  Do not add meals, attractions, shopping, hotels, transfers, rest blocks, or
  other filler. Sparse and empty days are correct when the traveller asked for
  a short fixed list across a longer trip.
- Set requested true only for an activity explicitly named in the request, an
  explicitly requested guide, or an existing calendar commitment. Similar,
  nearby, or normally necessary activities are not requested.
- Set named_place true only when the traveller named the venue itself. An
  activity they asked for at a venue you picked ("see the northern lights",
  so you chose a camp) is requested but not a named place. The app asks the
  traveller which branch they meant only for the places they named, and
  trusts your choice for the rest.
- When there is no exclusive constraint, keep each day realistic: 3 to 5
  activities, geographically sensible, no zig-zagging across a city and back.
- One place, one activity. Every activity is a stop on the map, and a stop
  that names several places has nowhere to be. "Shopping at Ralph Lauren and
  the MoMA Design Store" is two activities, each at its own venue with its own
  time. Prefer the specific venue to the area: "Itoya Ginza" and "Ginza Six",
  not "Shopping in Ginza". An area is an activity only when the area itself is
  the point — a street to walk, a park — and then name where it starts. An
  area the traveller named themselves stays as they said it; places they named
  inside it are each an activity of their own.
- "location" is what you would type into Google Maps to land at that venue's
  door: its name, the building or store it is inside, the district and the city
  — "Senso-ji, Asakusa, Taito City, Tokyo", not "a nice temple" and not
  "Asakusa". The app looks up the exact street address from it, so an exact
  name and branch matter more than a street number; write a street address only
  when you were given one. Leave it blank rather than invent one.
- Put times in 24-hour HH:MM. Use them for things that are genuinely time-bound
  (opening hours, transport, bookings) and leave others null.
- For flights, start_time is local departure and end_time is local arrival. Put IANA zones in details.departure_timezone and details.arrival_timezone and the local arrival date YYYY-MM-DD in details.arrival_date, including overnight/date-line guides. details.from and details.to are the airports' three-letter IATA codes.
- For a flight the traveller has booked, never guess a time they did not give.
  For a flight you add between two places on the trip, give the departure you
  would plan the day around: the app swaps in the real flight closest to it.
- Costs are per person in the trip currency, as plain numbers. Use 0 when free,
  and give a real estimate rather than 0 for things that plainly cost money.
- Fill in every field you have an answer for. An end time wherever the length
  is reasonably known, a cost, and a note on every single activity. A day of
  activities with no end times and empty notes is a list, not a plan — the
  notes are most of what makes this worth reading, so never leave one blank.
- Structured facts go in their own fields, never in the title. A flight number
  is details.code, the airport is details.from and details.to, the terminal is
  details.from_terminal, the gate is details.gate, the seat is details.seat.
  The title is "Flight to Kuala Lumpur" — not "Flight: SIN (T2) → KUL (T1),
  MH 616". Put nothing in brackets after a title.
- details is for lodging dates (below) or transport, and only the keys that kind of transport has:
  a bus has no gate and a flight has no pier. Leave the rest null.
- Include travel between cities as a transport activity on the day it happens,
  and say which kind it is in "subtype". A Grab, a taxi or an airport pick-up
  is "transfer" — it is not a flight. Leave it null if you genuinely cannot
  tell; a wrong one is worse than none, because it puts an airline and a gate
  on a car guide.
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
- A hotel stay is ONE lodging record, never separate saved check-in/checkout
  records or daily stay activities. Set details.check_in_date/check_out_date
  (YYYY-MM-DD) and optional check_in_time/check_out_time (HH:MM) from confirmed
  booking information. Unknown values stay null. Put the record on check-in
  day, or checkout day if only that is known. The app derives both entries and
  intervening-night icons. Store the cost once. Do not guess times or dates.
  Preserve dates outside the trip; never silently extend or shorten a booking.
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

/** The filled-in details of a guide, and nothing else. */
function cleanDetails(a) {
  if (cleanCategory(a.category) === 'lodging') return cleanLodging(a.details);
  if (cleanCategory(a.category) !== 'transport') return {};
  const mode = TRANSPORT.find((t) => t.id === a.subtype);
  if (!mode) return {};
  const allowed = new Set(mode.fields.map((f) => f.k));
  const src = (a.details && typeof a.details === 'object') ? a.details : {};
  return Object.entries(src).reduce((o, [k, v]) => {
    const val = String(v == null ? '' : v).trim().slice(0, 120);
    return allowed.has(k) && val ? { ...o, [k]: val } : o;
  }, {});
}

function cleanActivity(a, fix) {
  const it = fix ? fix(a) : a;
  return {
    title: String(it.title || '').trim().slice(0, 200) || 'Untitled',
    start_time: cleanTime(it.start_time),
    category: cleanCategory(it.category),
    // Never on anything else: a subtype on a dinner would show transport
    // fields on a restaurant.
    subtype: cleanCategory(it.category) === 'transport'
      && TRANSPORT_IDS.includes(it.subtype) ? it.subtype : null,
    end_time: cleanTime(it.end_time),
    booking_ref: String(it.booking_ref || '').trim().slice(0, 120),
    /* Only what this kind of guide actually has, and only what was filled
       in — a jsonb full of nulls is a row that looks answered and is not. */
    details: cleanDetails(it),
    location: String(it.location || '').trim().slice(0, 300),
    // Whether the traveller chose this venue. Only theirs is asked about
    // when the lookup finds it in more than one spot; the planner's own pick stands.
    named_place: it.named_place === true,
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

const BRIEF_CHECK = {
  type: 'object',
  additionalProperties: false,
  required: ['ready', 'origin', 'questions'],
  properties: {
    ready: { type: 'boolean' },
    origin: {
      type: ['string', 'null'],
      description: 'Where the traveller says they are travelling from, in their words. Null when the request does not say.',
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'ask', 'kind', 'options'],
        properties: {
          id: { type: 'string', description: 'Short stable key such as dates or pace' },
          ask: { type: 'string', description: 'One direct question under sixteen words' },
          kind: {
            type: 'string',
            enum: ['choice', 'multi', 'text'],
            description: 'choice: one answer. multi: several can apply. text: nothing listable.',
          },
          options: {
            type: 'array',
            description: 'Two to four short answers for choice, two to six for multi, empty for text',
            items: { type: 'string' },
          },
        },
      },
    },
  },
};

const BRIEF_SYSTEM = `You check a travel request before an itinerary is built.

Ask only about missing information that would materially change the trip. The
most useful facts are exact timing or trip length, who is travelling and any
mobility needs, pace, budget level, fixed bookings, and the one or two things
the traveller cares about most.

Rules:
- Return at most three questions.
- Never show internal activity IDs or Google place IDs in questions or options.
  Use readable place names and addresses instead.
- Do not ask for something the request already answers.
- Treat "only", "exclusively", "nothing else", and equivalent wording as a
  complete instruction. Do not ask how to fill the remaining time.
- Do not ask generic preference questions just to make conversation.
- Use "choice" when exactly one of two to four useful defaults is the answer
  (pace, budget level).
- Use "multi" when the traveller could want several at once: which countries
  or cities, which interests, which kinds of activity. Each option is one thing
  that stands on its own, because they are ticked independently: "Norway",
  "Sweden", "Denmark", never "Norway only" or "Norway and Sweden"; combinations
  are what ticking two is for. If the answers are combinations of each other,
  it is a "choice".
- Include "No preference" when it is a sensible choice, as the last option.
- Use text only for an exact date, place, budget, booking, or constraint that
  cannot be represented honestly as a short choice.
- Never ask where they are travelling from: the app asks that itself, once,
  and remembers it.
- Set ready true and return no questions when the request already has enough
  information for a good plan.`;

/*
 * The one question the app asks rather than the model: where the trip starts,
 * which decides its flights (app/api/flights). Asked only while the account
 * has no home, and kept as it once answered (lib/home.js), so it is asked once.
 */
const ORIGIN_QUESTION = {
  id: 'origin',
  ask: 'Where are you travelling from?',
  kind: 'text',
  options: [],
};

/**
 * What the traveller already has on, during the trip they are asking for.
 *
 * Returns nothing at all unless they have connected a calendar — no request is
 * made, and the planner is told nothing. Everything here is best-effort: a trip
 * planned without the calendar is the behaviour this has always had, and is a
 * far better outcome than a failure.
 */
async function theirCalendar(user, prompt, today, fixed) {
  try {
    if (!(await connection(user.id))) return null;

    // Dates already settled with the flights are the dates; no need to ask again.
    const when = fixed ? fixed : await askJson({
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
  // The host cuts the request off at maxDuration; the stream is closed by us
  // a little before that, so the page hears "cut" and picks the plan up.
  const deadline = Date.now() + (maxDuration - 15) * 1000;
  if (!aiConfigured()) return notConfigured();
  /*
   * Signed in, like every other route that pays for a model. A whole plan on
   * the better model is the dearest call in the app, and this one was open to
   * anyone who could reach the address. The planner page has always sent its
   * token with the plan itself, for the calendar; the brief check before it
   * now sends it too.
   */
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();

  let prompt = '';
  let today = '';
  let mode = '';
  // Set when the page is picking up a plan whose stream stopped part way.
  let resume = null;
  // Dates and flights the page settled before planning (lib/flightPlan.js).
  let fixed = null;
  try {
    const body = (await req.json()) || {};
    prompt = String(body.prompt || '').trim().slice(0, 6000);
    today = String(body.today || '').slice(0, 10);
    mode = String(body.mode || '');
    resume = readResume(body.resume);
    fixed = cleanFixed(body.fixed);
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  if (!prompt) return Response.json({ error: 'Describe the trip you want.' }, { status: 400 });

  if (mode === 'clarify') {
    try {
      const out = await askJson({
        schemaName: 'trip_brief_check',
        schema: BRIEF_CHECK,
        system: BRIEF_SYSTEM,
        task: 'brief',
        maxTokens: 1800,
        user: `Today is ${today || 'unknown'}.

Travel request:
${prompt}`,
      });
      const questions = (Array.isArray(out.questions) ? out.questions : []).slice(0, 3)
        .map((q, i) => {
          const multi = q.kind === 'multi';
          const options = (Array.isArray(q.options) ? q.options : [])
            .map((o) => publicAgentText(o).slice(0, 80)).filter(Boolean).slice(0, multi ? 6 : 4);
          return {
            id: String(q.id || `question-${i + 1}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 32)
              || `question-${i + 1}`,
            ask: publicAgentText(q.ask).slice(0, 180),
            kind: q.kind === 'text' || options.length < 2 ? 'text' : (multi ? 'multi' : 'choice'),
            options,
          };
        }).filter((q) => q.ask);
      const askOrigin = !homeOf(user) && !String(out.origin || '').trim() && !hasExclusiveScope(prompt)
        && !questions.some((q) => /travel+ing from|flying from|depart(ing)? from/i.test(q.ask));
      if (askOrigin) questions.push(ORIGIN_QUESTION);
      return Response.json({ ready: (!!out.ready && !askOrigin) || !questions.length, questions });
    } catch (e) {
      return aiFailure(e, 'brief');
    }
  }

  const strictOnly = hasExclusiveScope(prompt);

  const mine = await theirCalendar(user, prompt, today, fixed);
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
    ...(fixed ? [] : [
      '',
      `Unless the request clearly says otherwise, start the trip on ${mine.from}`
        + ` and run it for ${mine.days} day${mine.days === 1 ? '' : 's'}.`,
    ]),
  ].join('\n') : '';
  const scopeBlock = strictOnly ? `

HARD EXCLUSIVE SCOPE:
The traveller asked for only the activities or guides they named. Do not fill
unused time. Every activity not explicitly requested must have requested=false
and will be removed before the traveller sees it.` : '';

  /*
   * The plan is kept on the server as it is written, so a tab that falls
   * asleep part way — Edge drops its connections — finds it when it wakes
   * (lib/planDraft.js). Null until the plan_drafts table exists, and then
   * everything below behaves as it did without it.
   */
  const db = asUser(req);
  const draftId = await openDraft(db);

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      /*
       * Without a draft, a traveller who leaves while the model is still
       * thinking takes the request with them, rather than leaving it to run
       * and be billed. With one, leaving is usually a tab gone to sleep, and
       * the plan is finished for when it wakes; Cancel stops it through the
       * draft instead.
       */
      ...(draftId ? {} : { signal: req.signal }),
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
              + `\n\n${prompt}${scopeBlock}${fixedBlock(fixed)}${calendarBlock}`
              + `${resume ? resumeInstruction(resume) : ''}`,
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
  // The flights there and home are the page's to add; a copy the model wrote is dropped.
  const includeActivity = (activity, day) => (!strictOnly || activity.requested === true)
    && !isHomeFlight(activity, fixed, day);
  const exclusiveSummary = 'Only the places and guides you requested are included. '
    + 'The remaining time is left open.';

  // A pick-up writes only the days after the ones the page already has.
  const fromDay = resume ? resume.from : 1;

  // Settles when the answer has been read to its end and the draft written.
  let settle;
  const finished = new Promise((resolve) => { settle = resolve; });

  const stream = relayStream(upstream, async ({
    text: chunks, send: write, gone, progress, stop, stopped,
  }) => {
    const send = (obj) => write(`${JSON.stringify(obj)}\n`);

    // What the client already knows, so each event carries only what is new.
    let sentMeta = '';
    const sentThemes = new Map();
    const sentCounts = new Map();
    let text = '';
    // How much of the answer has closed, so the watchdog knows it is moving.
    let written = 0;
    let lastDay = 0;

    // The same events, kept as a plan for the draft.
    const draft = draftId
      ? draftWriter(db, draftId, { onCancelled: () => stop('cancelled') })
      : null;
    let keptMeta = {};
    const keptDays = new Map();
    let savedDay = 0;
    const keptDay = (idx) => {
      if (!keptDays.has(idx)) keptDays.set(idx, { day_index: idx, theme: '', activities: [] });
      return keptDays.get(idx);
    };
    const snapshot = () => ({
      ...keptMeta,
      days: [...keptDays.values()]
        .sort((a, b) => a.day_index - b.day_index)
        .map((d) => ({ ...d, activities: d.activities.slice() })),
    });
    // Said first, so the page knows where to look if this connection is lost.
    if (draftId) send({ t: 'job', id: draftId });

    const flush = () => {
      const partial = parsePartial(text);
      if (!partial || typeof partial !== 'object') return;

      const parsedDays = Array.isArray(partial.days) ? partial.days : [];
      const size = Object.keys(partial).length + parsedDays.reduce((n, d) => n + 1
        + (d && Array.isArray(d.activities) ? d.activities.length : 0), 0);
      if (size > written) { written = size; progress(); }

      const meta = {
        name: typeof partial.name === 'string' ? partial.name : '',
        destination: typeof partial.destination === 'string' ? partial.destination : '',
        // The flights' fares are in this one; a resumed plan keeps what this said.
        currency: (fixed && fixed.currency)
          || (typeof partial.currency === 'string' ? partial.currency : ''),
        duration_days: fixed ? fixed.duration_days : (Number(partial.duration_days) || 0),
        summary: strictOnly
          ? exclusiveSummary
          : (typeof partial.summary === 'string' ? partial.summary : ''),
      };
      const metaKey = JSON.stringify(meta);
      if (metaKey !== sentMeta) { sentMeta = metaKey; keptMeta = meta; send({ t: 'meta', ...meta }); }

      parsedDays.forEach((d) => {
        if (!d || typeof d !== 'object') return;
        const idx = Number(d.day_index);
        if (!Number.isInteger(idx) || idx < fromDay) return;
        lastDay = Math.max(lastDay, idx);

        const acts = Array.isArray(d.activities) ? d.activities : [];
        const theme = typeof d.theme === 'string' ? d.theme : '';
        if ((!strictOnly || acts.some((x) => includeActivity(x, idx))) && sentThemes.get(idx) !== theme) {
          sentThemes.set(idx, theme);
          keptDay(idx).theme = theme;
          send({ t: 'day', i: idx, theme });
        }

        const already = sentCounts.get(idx) || 0;
        for (let k = already; k < acts.length; k += 1) {
          // parsePartial only ever yields complete objects, so this is whole.
          if (includeActivity(acts[k], idx)) {
            const a = cleanActivity(acts[k], fix);
            keptDay(idx).activities.push(a);
            send({ t: 'act', d: idx, a });
          }
        }
        if (acts.length > already) sentCounts.set(idx, acts.length);
      });

      // Saved once a day, as the next one starts and the last is whole.
      if (draft && lastDay > savedDay) { savedDay = lastDay; draft.save(snapshot()); }
    };

    let reading = true;
    try {
      for await (const chunk of chunks) {
        text += chunk;
        /*
         * parsePartial reads the whole answer so far, and its result only
         * changes when a structure closes outside a string. Parsing it again
         * for every chunk made a long plan quadratic — thousands of re-reads
         * of tens of kilobytes — for events that could not have changed.
         */
        if (/[}\]]/.test(chunk)) flush();
      }
      reading = false;
      // Cancelled: nobody is reading, nothing keeps it, and what arrived is not a plan.
      if (gone() && !draft) return;

      /*
       * Stopped part way — the answer went quiet, or the host's time limit is
       * close. Said out loud, so the page picks the plan up from the last day
       * it has instead of waiting on a stream that has nothing more to say.
       */
      const why = stopped();
      // Cancel: the draft already says so, and nobody wants the rest.
      if (why === 'cancelled') {
        console.warn(`[plan] cancelled at day ${lastDay || '-'}; the model is stopped`);
        return;
      }
      if (why) {
        console.warn(`[plan] answer stopped (${why}) at day ${lastDay || '-'}; the page picks it up`);
        if (draft) await draft.finish('stopped', snapshot());
        send({ t: 'cut', why });
        return;
      }

      if (!text.trim()) {
        // Same trap as the blocking routes: the budget can be spent entirely
        // on reasoning, leaving no itinerary behind.
        throw new Error('The model produced no itinerary — it may have spent its '
          + 'budget reasoning. Try again, or lower the plan effort in TASKS.');
      }
      let final;
      try {
        final = JSON.parse(text);
      } catch (e) {
        // Ended without finishing: a dropped connection or a length limit.
        // What arrived is good, and the rest can be asked for.
        console.warn(`[plan] answer ended unfinished at day ${lastDay || '-'}; the page picks it up`);
        if (draft) await draft.finish('stopped', snapshot());
        send({ t: 'cut', why: 'unfinished' });
        return;
      }
      const duration = fixed ? fixed.duration_days
        : Math.min(30, Math.max(1, Number(final.duration_days) || 1));
      const days = (Array.isArray(final.days) ? final.days : [])
        .filter((d) => Number(d.day_index) >= fromDay && Number(d.day_index) <= duration)
        .map((d) => ({
          day_index: Number(d.day_index),
          theme: String(d.theme || ''),
          activities: (Array.isArray(d.activities) ? d.activities : [])
            .filter((x) => includeActivity(x, Number(d.day_index))).slice(0, 8).map((x) => cleanActivity(x, fix)),
        }))
        .filter((d) => !strictOnly || d.activities.length > 0);

      const plan = {
        name: String(final.name || '').trim().slice(0, 120) || 'New trip',
        destination: String(final.destination || '').trim().slice(0, 200),
        timezone: validZone(final.timezone) ? final.timezone : null,
        // With flights found, their fares are in this currency and on these dates.
        currency: (fixed && fixed.currency)
          || (/^[A-Z]{3}$/.test(final.currency) ? final.currency : 'SGD'),
        start_date: fixed ? fixed.start_date
          : (/^\d{4}-\d{2}-\d{2}$/.test(final.start_date || '') ? final.start_date : null),
        duration_days: duration,
        summary: strictOnly
          ? exclusiveSummary
          : String(final.summary || '').trim().slice(0, 500),
        days,
      };
      // Kept before it is sent, so a page that missed the send finds it there.
      if (draft) await draft.finish('done', plan);
      send({ t: 'done', plan });
    } catch (e) {
      // Whatever went wrong, a page waiting on the draft must not wait on it.
      if (draft) await draft.finish('stopped', snapshot());
      if (!draft && (gone() || (e && e.name === 'AbortError'))) return;
      if (reading) {
        // The connection to the model broke; the days that arrived still stand.
        console.warn(`[plan] answer broke off at day ${lastDay || '-'} (${(e && e.message) || e}); the page picks it up`);
        send({ t: 'cut', why: 'broken' });
        return;
      }
      console.error('[ai] plan stream failed:', (e && e.message) || e);
      send({ t: 'error', error: 'Something went wrong on our end. Please try again.' });
    } finally {
      settle();
    }
  }, {
    beat: `${JSON.stringify({ t: 'wait' })}\n`,
    beatMs: BEAT_MS,
    firstMs: PLAN_FIRST_MS,
    quietMs: PLAN_QUIET_MS,
    deadline,
    // With a draft, the answer is finished and kept even after the tab has gone.
    detached: !!draftId,
  });

  // And the host is asked to keep this request alive until it is, not just
  // until the browser stops listening.
  if (draftId) after(() => finished);

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
