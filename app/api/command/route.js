import {
  aiFailure,
  askJson, aiConfigured, notConfigured, AI_CATEGORIES, cleanCategory, cleanTime,
} from '@/lib/ai';
import { TRANSPORT } from '@/lib/transport';
import { publicAgentText } from '@/lib/agentText';

/*
 * The kinds of journey and the fields each one has, from the app's own table.
 *
 * Absent from this schema until now, which is why "change these to flights"
 * came back as four notes saying so: with no subtype field to set, appending a
 * line about it was the only move the shape allowed. A model asked to do
 * something it has no field for will always do the nearest thing it can.
 */
const TRANSPORT_IDS = TRANSPORT.map((t) => t.id);
const DETAIL_KEYS = [...new Set(TRANSPORT.flatMap((t) => t.fields.map((f) => f.k)))];
const DETAILS = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: DETAIL_KEYS,
  properties: DETAIL_KEYS.reduce((o, k) => ({ ...o, [k]: { type: ['string', 'null'] } }), {}),
};

export const runtime = 'nodejs';
/*
 * Editing a whole trip is a minute of work for the model on a long itinerary.
 * Without this a host cuts the request off at its default and the reader sees
 * a failure that was really a deadline.
 */
export const maxDuration = 300;

const KINDS = [
  'update_trip', 'add_activity', 'update_activity', 'move_activity', 'delete_activity',
  // Bulk kinds. One of these stands in for a whole run of single edits — see
  // the note on the schema below.
  'shift_times', 'clear_day', 'move_day', 'edit_many',
];

/**
 * Strict mode requires every property on every object, so one flat operation
 * shape carries all of them and leaves the irrelevant ones null. A union per
 * operation kind would be cleaner to read and is not expressible here.
 *
 * That makes each operation expensive: every one spends tokens on twenty keys
 * whether or not it uses them. "Push everything back an hour" over a fortnight
 * is fifty of those, which is what kept running the answer out of room — and
 * the length of the reply had nothing to do with the difficulty of the
 * request. So the bulk kinds exist to let one operation say what was actually
 * meant, and the app works out which activities that lands on.
 */
const OP = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind', 'describe', 'activity_id', 'day', 'title', 'start_time', 'end_time',
    'category', 'subtype', 'details', 'location', 'cost', 'notes',
    'trip_name', 'destination', 'start_date', 'end_date', 'currency', 'budget',
    'minutes', 'to_day', 'items',
  ],
  properties: {
    kind: { type: 'string', enum: KINDS },
    describe: { type: 'string', description: 'One short line a person can check, e.g. "Move Senso-ji to Day 4"' },
    activity_id: { type: ['string', 'null'], description: 'Exactly as given in the trip listing' },
    day: { type: ['string', 'null'], description: 'YYYY-MM-DD, within the trip' },
    title: { type: ['string', 'null'] },
    start_time: { type: ['string', 'null'], description: '24h HH:MM' },
    end_time: { type: ['string', 'null'] },
    category: { type: ['string', 'null'], enum: [...AI_CATEGORIES, null] },
    subtype: {
      type: ['string', 'null'],
      enum: [...TRANSPORT_IDS, null],
      description: 'Transport only: which kind of journey it is. A taxi, a Grab or an '
        + 'airport pick-up is "transfer". Null to leave it as it is.',
    },
    details: DETAILS,
    location: { type: ['string', 'null'], description: 'Real, searchable place name' },
    cost: { type: ['number', 'null'] },
    notes: { type: ['string', 'null'] },
    trip_name: { type: ['string', 'null'] },
    destination: { type: ['string', 'null'] },
    start_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    end_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    currency: { type: ['string', 'null'], description: 'ISO 4217' },
    budget: { type: ['number', 'null'] },
    minutes: {
      type: ['integer', 'null'],
      description: 'shift_times only: minutes to move every start and end time. Negative is earlier.',
    },
    to_day: { type: ['string', 'null'], description: 'move_day only: YYYY-MM-DD to move the day to' },
    items: {
      type: ['array', 'null'],
      description: 'edit_many only: one small entry per activity being changed',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'activity_id', 'note_add', 'start_time', 'end_time', 'cost', 'subtype', 'details',
        ],
        properties: {
          activity_id: { type: 'string', description: 'Exactly as given in the trip listing' },
          subtype: {
            type: ['string', 'null'],
            enum: [...TRANSPORT_IDS, null],
            description: 'Transport only. Null to leave it alone.',
          },
          details: DETAILS,
          note_add: {
            type: ['string', 'null'],
            description: 'One short line to append to the existing notes. Never a rewrite.',
          },
          start_time: { type: ['string', 'null'], description: '24h HH:MM' },
          end_time: { type: ['string', 'null'] },
          cost: { type: ['number', 'null'] },
        },
      },
    },
  },
};

/*
 * The sanitiser below names every field it will pass on, which is the right
 * shape for a route that hands work to a model — but it means a new field has
 * to be added in four places before it does anything, and forgetting the
 * fourth looks exactly like the model ignoring the request.
 */
function cleanSub(v) {
  return TRANSPORT_IDS.includes(v) ? v : null;
}

function cleanDetails(v) {
  if (!v || typeof v !== 'object') return null;
  const out = Object.entries(v).reduce((o, [k, val]) => {
    const t = String(val == null ? '' : val).trim().slice(0, 120);
    return DETAIL_KEYS.includes(k) && t ? { ...o, [k]: t } : o;
  }, {});
  return Object.keys(out).length ? out : null;
}

/**
 * A question worth interrupting for, asked so it can be answered in a tap.
 *
 * A blank box is the laziest way to ask something: it makes the reader guess
 * both the answer and the vocabulary it should be phrased in, and half of the
 * replies then need a question of their own. Nearly every ambiguity here is a
 * choice between a handful of readings the model has already thought of, so it
 * has to name them. Free text stays available for the ones that genuinely are
 * open — a number, a date, a place — and as an escape hatch under every list.
 */
const QUESTION = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['ask', 'header', 'kind', 'options'],
  properties: {
    ask: {
      type: 'string',
      description: 'One short question in plain words, under fifteen words. The '
        + 'options carry the detail, so do not list them again here.',
    },
    header: {
      type: 'string',
      description: 'Two or three words naming what is being decided, e.g. "Which three"',
    },
    kind: {
      type: 'string',
      enum: ['choice', 'multi', 'text'],
      description: 'choice: one answer. multi: several can apply. text: nothing listable.',
    },
    options: {
      type: ['array', 'null'],
      description: 'choice and multi only: two to four answers. Null for text.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'detail'],
        properties: {
          label: { type: 'string', description: 'The answer itself, two to six words' },
          detail: {
            type: ['string', 'null'],
            description: 'One short line on what choosing it would do to this trip',
          },
        },
      },
    },
  },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['understood', 'question', 'summary', 'ops'],
  properties: {
    understood: { type: 'boolean' },
    question: QUESTION,
    summary: { type: 'string', description: 'One line describing the whole change' },
    ops: { type: 'array', items: OP },
  },
};

const SYSTEM = `You turn an instruction about a trip into a list of concrete edits.

You are given the trip and every activity in it, each with an id. Reference
activities by that exact id — never invent one.

Prefer one bulk operation to a run of single ones. They are exact, not
approximations, and the app expands them:
- shift_times: move every time on a day by "minutes" (day null = the whole
  trip). Use this for "push everything back an hour", never a list of
  update_activity.
- clear_day: remove everything on a day.
- move_day: move everything on a day to another date.
- edit_many: the same kind of small change across many activities — a line of
  advice, a time, a price. One edit_many with an entry per activity, NOT one
  update_activity each: an update_activity carries every field of an activity
  whether or not it uses them, so twenty of them is a very long answer to a
  short request and is the usual reason a large edit fails to finish.
  note_add is appended to what the activity already says; it never replaces it.

Never emit more than about ten single-activity operations. If a change touches
more than that, it is a bulk change and one of the kinds above expresses it —
a long list of update_activity is both slower to write and harder to check.

You may also be given what is already in the traveller's own calendar on
these dates, under "In their calendar". Those are not part of the trip and you
cannot change them, but you can be asked to bring one into the trip — "add my
flight from my calendar", "put the dinner booking in". Do that with an
add_activity on the day it falls, keeping its title, its time and its place.
Never add one that is already in the trip, and never invent a calendar entry
that is not in that list.

Rules:
- Internal activity IDs and Google place IDs are only for structured fields.
  Never put them in questions, headers, options, summaries or descriptions.
  Identify places using their names, dates and readable addresses instead.
- Emit only the edits the instruction actually calls for. Do not tidy, reorder
  or improve anything that was not asked about.
- Past conversation is context. Use it when the current instruction refers to
  an earlier request, decision, or answer. Never repeat an old edit unless the
  current instruction asks for it.
- "describe" is what a person will read before approving, so make it specific:
  "Delete Tokyo Skytree from Day 1", not "Delete an activity".
- Only use update_trip for trip-level fields: name, destination, dates,
  currency, budget.
- Transport activities have a kind and their own fields. Setting them is a real
  edit, not a note: "make these flights" is subtype "flight" on each, and the
  flight number goes in details.code, the airports in details.from and
  details.to, the terminal in details.from_terminal, the gate in details.gate.
  Never write a note describing a change you could have made.
- details only takes the keys that kind of journey has — a bus has no gate, a
  flight has no pier. Leave the others null, and send details null when there
  is nothing to set.
- Lengthening or shortening the trip is an update_trip on the dates. If that
  would leave activities outside the range, move them too.
- Times are 24-hour HH:MM. Costs are plain numbers in the trip currency.
- "location" must be a real place name a map search would find, or null.
- If the instruction is ambiguous in a way that changes which activities are
  touched, set understood false and ask ONE question instead of guessing.
  Offer answers rather than a blank box. Use kind "choice" when one reading out
  of two to four is right, "multi" when several can apply at once (days,
  categories, particular activities), and "text" only when the answer is a
  number, a date or a name that cannot be listed. Options must be concrete and
  about this trip — "Keep the three earliest each day", not "Option A" — and
  "detail" should say what that would actually do here. Do not write an "other"
  or "something else" option: the app always offers one.
  For "multi" every option must be one thing that stands on its own, because
  they are ticked independently: list "Day 2 (Aug 22)", "Day 3 (Aug 23)", not
  "Day 2 only" or "all of them" — combinations are what ticking two boxes is
  for. If the answers are combinations of each other, it is a "choice".
  Write labels the way a traveller reads them: "Day 4 (Aug 24)", never a bare
  2026-08-24. Keep a label under about eight words.
- A second question is allowed if the first answer opens a real fork, but stop
  there and make your best reading of anything still unsettled.
- An instruction that would delete a lot should still be obeyed; the person
  reviews the list before anything happens.`;

/** Shorten to a limit without ending mid-word. */
function trim(value, limit) {
  const s = String(value || '').trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const at = cut.lastIndexOf(' ');
  return `${(at > limit * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const instruction = String(body.instruction || '').trim().slice(0, 2000);
  if (!instruction) return Response.json({ error: 'Nothing to do.' }, { status: 400 });

  const trip = body.trip || {};
  // Every answer so far, not just the last: a choice like "let me pick which
  // ones" only means anything alongside the question it answered.
  const answers = (Array.isArray(body.answers) ? body.answers : [body.answer])
    .filter(Boolean).map((a) => String(a).slice(0, 300)).slice(0, 6);
  const activities = (Array.isArray(body.activities) ? body.activities : []).slice(0, 80);
  /* What the traveller already has on, sent only when a calendar is connected
     and only ever for the trip's own dates. */
  const booked = (Array.isArray(body.calendar) ? body.calendar : []).slice(0, 40);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-16).map((m) => ({
    role: m && m.role === 'assistant' ? 'Wander' : 'Traveller',
    kind: String((m && m.kind) || 'message').slice(0, 40),
    content: String((m && m.content) || '').trim().slice(0, 700),
  })).filter((m) => m.content);

  const listing = activities.map((a) => [
    `id=${a.id}`,
    a.day,
    a.start_time || '--:--',
    a.title,
    a.category,
    a.location ? `at ${a.location}` : '',
    a.cost ? `${a.cost}` : '',
  ].filter(Boolean).join(' | ')).join('\n');

  /*
   * Which date is "day 4".
   *
   * Nobody thinks of their trip as 2026-08-24, and the model can only answer in
   * the vocabulary it was given — without this it wrote options and summaries
   * full of ISO dates, which are exact and unreadable.
   */
  const dayNames = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(trip.start_date || '')) {
    const at = new Date(`${trip.start_date}T00:00:00Z`);
    const end = /^\d{4}-\d{2}-\d{2}$/.test(trip.end_date || '') ? trip.end_date : trip.start_date;
    for (let n = 1; n <= 60; n += 1) {
      const iso = at.toISOString().slice(0, 10);
      dayNames.push(`Day ${n} = ${iso}`);
      if (iso >= end) break;
      at.setUTCDate(at.getUTCDate() + 1);
    }
  }

  const prompt = [
    `Trip: ${trip.name || 'Untitled'}`,
    `Destination: ${trip.destination || 'unspecified'}`,
    `Dates: ${trip.start_date} to ${trip.end_date}`,
    `Currency: ${trip.currency || 'SGD'}`,
    `Budget: ${trip.budget == null ? 'none' : trip.budget}`,
    dayNames.length ? `Days: ${dayNames.join(', ')}` : '',
    '',
    'Activities:',
    listing || '(none yet)',
    '',
    ...(booked.length ? [
      'In their calendar (not part of the trip):',
      ...booked.map((e) => {
        const day = String(e.start || '').slice(0, 10);
        const when = e.allDay ? 'all day' : String(e.start || '').slice(11, 16);
        const where = e.where ? ` @ ${String(e.where).slice(0, 80)}` : '';
        return `- ${day} ${when} ${String(e.title || 'Busy').slice(0, 80)}${where}`;
      }),
      '',
    ] : []),
    ...(history.length ? [
      'Past conversation about this trip, oldest first:',
      ...history.map((m) => `- ${m.role} [${m.kind}]: ${m.content}`),
      '',
    ] : []),
    `Instruction: "${instruction}"`,
    ...(answers.length
      ? ['They then answered your questions, in order:', ...answers.map((a) => `- ${a}`)]
      : []),
  ].join('\n');

  try {
    const out = await askJson({
      schemaName: 'trip_edits',
      schema: SCHEMA,
      system: SYSTEM,
      task: 'command',
      user: prompt,
      maxTokens: 12000,
    });

    if (!out.understood && out.question) {
      const q = out.question;
      const options = (Array.isArray(q.options) ? q.options : []).slice(0, 4).map((o) => ({
        label: publicAgentText(o && o.label, activities).slice(0, 80),
        detail: publicAgentText(o && o.detail, activities).slice(0, 160),
      })).filter((o) => o.label);
      return Response.json({
        understood: false,
        question: {
          // Cut at a word, never mid-syllable: a question that ends "or do yo"
          // reads like the app broke rather than like the model ran long.
          ask: trim(publicAgentText(q.ask, activities) || 'Which place did you mean?', 240),
          header: publicAgentText(q.header, activities).slice(0, 28),
          // A list with nothing in it is a box with a label; ask for words.
          kind: options.length && q.kind !== 'text' ? (q.kind === 'multi' ? 'multi' : 'choice') : 'text',
          options,
        },
      });
    }

    // Only ever act on activities that exist, and only in ways we implement.
    const known = new Set(activities.map((a) => String(a.id)));
    const ops = (Array.isArray(out.ops) ? out.ops : []).slice(0, 40).map((o) => {
      if (!KINDS.includes(o.kind)) return null;
      const needsId = ['update_activity', 'move_activity', 'delete_activity'].includes(o.kind);
      if (needsId && !known.has(String(o.activity_id))) return null;
      return {
        kind: o.kind,
        describe: publicAgentText(o.describe, activities).slice(0, 160),
        activity_id: o.activity_id || null,
        day: /^\d{4}-\d{2}-\d{2}$/.test(o.day || '') ? o.day : null,
        title: o.title == null ? null : String(o.title).slice(0, 200),
        start_time: cleanTime(o.start_time),
        end_time: cleanTime(o.end_time),
        category: o.category == null ? null : cleanCategory(o.category),
        subtype: cleanSub(o.subtype),
        details: cleanDetails(o.details),
        location: o.location == null ? null : String(o.location).slice(0, 300),
        cost: o.cost == null ? null : Math.max(0, Number(o.cost) || 0),
        notes: o.notes == null ? null : String(o.notes).slice(0, 1000),
        trip_name: o.trip_name == null ? null : String(o.trip_name).slice(0, 120),
        destination: o.destination == null ? null : String(o.destination).slice(0, 200),
        start_date: /^\d{4}-\d{2}-\d{2}$/.test(o.start_date || '') ? o.start_date : null,
        end_date: /^\d{4}-\d{2}-\d{2}$/.test(o.end_date || '') ? o.end_date : null,
        currency: /^[A-Z]{3}$/.test(o.currency || '') ? o.currency : null,
        budget: o.budget == null ? null : Math.max(0, Number(o.budget) || 0),
        // A day either way is as far as a shift can sensibly reach.
        minutes: Number.isFinite(Number(o.minutes))
          ? Math.max(-1440, Math.min(1440, Math.trunc(Number(o.minutes)))) : null,
        to_day: /^\d{4}-\d{2}-\d{2}$/.test(o.to_day || '') ? o.to_day : null,
        items: Array.isArray(o.items) ? o.items.slice(0, 80).map((it) => (
          known.has(String(it.activity_id)) ? {
            activity_id: it.activity_id,
            note_add: it.note_add == null ? null : String(it.note_add).slice(0, 400),
            start_time: cleanTime(it.start_time),
            end_time: cleanTime(it.end_time),
            cost: it.cost == null ? null : Math.max(0, Number(it.cost) || 0),
            subtype: cleanSub(it.subtype),
            details: cleanDetails(it.details),
          } : null
        )).filter(Boolean) : null,
      };
    }).filter(Boolean);

    return Response.json({
      understood: true,
      summary: publicAgentText(out.summary, activities).slice(0, 300),
      ops,
    });
  } catch (e) {
    return aiFailure(e, 'command');
  }
}
