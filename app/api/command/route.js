import {
  aiFailure,
  askJson, aiConfigured, notConfigured, AI_CATEGORIES, cleanCategory, cleanTime,
} from '@/lib/ai';

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
    'category', 'location', 'cost', 'notes',
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
        required: ['activity_id', 'note_add', 'start_time', 'end_time', 'cost'],
        properties: {
          activity_id: { type: 'string', description: 'Exactly as given in the trip listing' },
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

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['understood', 'question', 'summary', 'ops'],
  properties: {
    understood: { type: 'boolean' },
    question: { type: 'string', description: 'One short question when understood is false' },
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

Rules:
- Emit only the edits the instruction actually calls for. Do not tidy, reorder
  or improve anything that was not asked about.
- "describe" is what a person will read before approving, so make it specific:
  "Delete Tokyo Skytree from Day 1", not "Delete an activity".
- Only use update_trip for trip-level fields: name, destination, dates,
  currency, budget.
- Lengthening or shortening the trip is an update_trip on the dates. If that
  would leave activities outside the range, move them too.
- Times are 24-hour HH:MM. Costs are plain numbers in the trip currency.
- "location" must be a real place name a map search would find, or null.
- If the instruction is ambiguous in a way that changes which activities are
  touched, set understood false and ask one short question instead of guessing.
- An instruction that would delete a lot should still be obeyed; the person
  reviews the list before anything happens.`;

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const instruction = String(body.instruction || '').trim().slice(0, 600);
  if (!instruction) return Response.json({ error: 'Nothing to do.' }, { status: 400 });

  const trip = body.trip || {};
  const answer = String(body.answer || '').slice(0, 300);
  const activities = (Array.isArray(body.activities) ? body.activities : []).slice(0, 80);

  const listing = activities.map((a) => [
    `id=${a.id}`,
    a.day,
    a.start_time || '--:--',
    a.title,
    a.category,
    a.location ? `at ${a.location}` : '',
    a.cost ? `${a.cost}` : '',
  ].filter(Boolean).join(' | ')).join('\n');

  const prompt = [
    `Trip: ${trip.name || 'Untitled'}`,
    `Destination: ${trip.destination || 'unspecified'}`,
    `Dates: ${trip.start_date} to ${trip.end_date}`,
    `Currency: ${trip.currency || 'SGD'}`,
    `Budget: ${trip.budget == null ? 'none' : trip.budget}`,
    '',
    'Activities:',
    listing || '(none yet)',
    '',
    `Instruction: "${instruction}"`,
    answer ? `They then clarified: "${answer}"` : '',
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
      return Response.json({ understood: false, question: String(out.question).slice(0, 200) });
    }

    // Only ever act on activities that exist, and only in ways we implement.
    const known = new Set(activities.map((a) => String(a.id)));
    const ops = (Array.isArray(out.ops) ? out.ops : []).slice(0, 40).map((o) => {
      if (!KINDS.includes(o.kind)) return null;
      const needsId = ['update_activity', 'move_activity', 'delete_activity'].includes(o.kind);
      if (needsId && !known.has(String(o.activity_id))) return null;
      return {
        kind: o.kind,
        describe: String(o.describe || '').slice(0, 160),
        activity_id: o.activity_id || null,
        day: /^\d{4}-\d{2}-\d{2}$/.test(o.day || '') ? o.day : null,
        title: o.title == null ? null : String(o.title).slice(0, 200),
        start_time: cleanTime(o.start_time),
        end_time: cleanTime(o.end_time),
        category: o.category == null ? null : cleanCategory(o.category),
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
          } : null
        )).filter(Boolean) : null,
      };
    }).filter(Boolean);

    return Response.json({
      understood: true,
      summary: String(out.summary || '').slice(0, 300),
      ops,
    });
  } catch (e) {
    return aiFailure(e, 'command');
  }
}
