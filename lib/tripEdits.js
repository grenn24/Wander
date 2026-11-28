import {
  askJson, AI_CATEGORIES, cleanCategory, cleanTime,
} from './ai.js';
import { validZone } from '../public/trip-time.js';
import { TRANSPORT_IDS, detailsSchema, cleanDetails } from './entryShape.js';
import { publicAgentText } from './agentText.js';
import { calendarContext } from './commandCalendar.js';
import { activityListing } from './commandListing.js';
import { shortPlace } from './util.js';
import { findRealFlightsForEdits } from './realFlights.js';

/**
 * Turning an instruction about a trip into edits a person can check.
 *
 * Two ways in, one editor: the command bar (⌘K) sends what was typed, and the
 * trip Assistant sends the instruction it wrote when asked to change the plan.
 * Both get the same schema, the same rules and the same sanitising, so a
 * change asked for in a chat lands exactly as it would from the bar, and a
 * rule learned in one place is never missing from the other. Nothing here
 * writes: the edits go back to the page, which shows them and saves only
 * what the traveller approves.
 *
 * Before they go back, every flight in them is matched to the real one
 * (findRealFlightsForEdits, lib/realFlights.js), so what the traveller approves is the
 * actual airline, number and times rather than the model's guess at them.
 */

/*
 * The kinds of guide and the fields each one has, from the app's own table.
 *
 * Absent from this schema until now, which is why "change these to flights"
 * came back as four notes saying so: with no subtype field to set, appending a
 * line about it was the only move the shape allowed. A model asked to do
 * something it has no field for will always do the nearest thing it can.
 */
// The same fields every writer offers (lib/entryShape.js); null leaves them alone.
const DETAILS = detailsSchema({ nullable: true });

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
    'category', 'subtype', 'details', 'location', 'named_place', 'cost', 'notes',
    'trip_name', 'destination', 'start_date', 'end_date', 'currency', 'timezone', 'budget',
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
      description: 'Transport only: which kind of guide it is. A taxi, a Grab or an '
        + 'airport pick-up is "transfer". Null to leave it as it is.',
    },
    details: DETAILS,
    location: {
      type: ['string', 'null'],
      description: 'What to type into Google Maps to land on this exact venue: its name, '
        + 'the building it is in, the district and the city. Never only a district or a '
        + 'city for a specific venue.',
    },
    named_place: {
      type: 'boolean',
      description: 'True only when the traveller named this venue themselves: in the '
        + 'instruction, an answer, an attachment or their calendar. False when you chose '
        + 'it, even for something they asked for ("somewhere for lunch near the hotel"), '
        + 'and false for an operation with no location.',
    },
    cost: { type: ['number', 'null'] },
    notes: { type: ['string', 'null'] },
    trip_name: { type: ['string', 'null'] },
    destination: { type: ['string', 'null'] },
    start_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    end_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    timezone: { type: ['string', 'null'], description: 'update_trip only: IANA destination time zone, e.g. Asia/Tokyo. Null to leave unchanged.' },
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

/**
 * What an edit may set in details: only the fields this kind of entry has
 * (lib/entryShape.js), so a gate goes on a flight and never on a bus or a
 * dinner. A stay's field may be '' to clear it. Null when nothing is left,
 * which leaves the details as they are.
 */
function editDetails(category, subtype, details) {
  if (!details || typeof details !== 'object') return null;
  const out = cleanDetails(category, subtype, details, { clearing: true });
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
Match bookings using trip dates, destination, title, address AND description.
If one booking clearly matches, propose adding it without asking which entry.
Several records can describe one stay (confirmation, check-in and checkout):
reconcile these rather than treating them as competing hotels. Sequential stays
can all be relevant; do not invent a choice between them.
Ask only if genuinely conflicting bookings remain, offering their actual names
and dates as choices, never an empty "which hotel?" question.
Preserve the address, reservation details and check-in/checkout dates. A
multi-day stay is ONE lodging activity, never two saved activities or a daily
stay. Put YYYY-MM-DD dates in details.check_in_date and details.check_out_date;
optional HH:MM times in details.check_in_time and details.check_out_time. The
app derives both itinerary entries and intervening-night icons from one record.
Set day to the known check-in date, otherwise checkout, otherwise the trip start.
Keep cost once on that record. If either endpoint is outside the trip, first ask
whether to extend the trip or keep the full booking with out-of-range entries
listed separately. Never silently extend or truncate. If dates conflict, ask.
Unknown dates/times stay null; never infer coverage from one endpoint. Update an
existing hotel record instead of adding a duplicate. For a lodging date change,
use update_activity with details, not move_activity. An empty string clears a
lodging date/time; null leaves an existing value unchanged. Do not
invent times for all-day entries. If no matching booking exists, say what was
searched and ask for the missing booking details, not which unseen entry.

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
- Except for the lodging fields described above, details only takes the keys that kind of guide has — a bus has no gate, a
  flight has no pier. Leave the others null, and send details null when there
  is nothing to set.
- Lengthening or shortening the trip is an update_trip on the dates. If that
  would leave activities outside the range, move them too.
- Flight start_time and end_time are local to details.departure_timezone and details.arrival_timezone (IANA zones). Include details.arrival_date as YYYY-MM-DD, including date-line and overnight guides. Preserve unspecified zones; never substitute the browser zone.
- A flight's details.from and details.to are the airports' three-letter IATA
  codes. The app swaps a flight you add or move for the real flight nearest
  the departure you give, so give the time the day is planned around; for a
  flight the traveller has booked, give only what they told you. A flight
  "home" or "back" flies to one of their home airports.
- Times are 24-hour HH:MM. Costs are plain numbers in the trip currency.
- start_time and end_time are clock times, never durations. Each activity is
  listed with its current times as start–end. To make one stop N minutes
  longer or shorter, set only its end_time, to the listed end plus or minus N,
  and leave start_time null. To start one stop earlier or later, or move it to
  a new time, set both start_time and end_time so it keeps its length. One
  stop is an update_activity, never shift_times, which moves a whole day.
  "minutes" is only read by shift_times. If a stop has no end time and the
  change needs one, ask how long it should be rather than guessing.
- One place, one activity. Adding several places is one add_activity each,
  never one activity that names them all: "add Ralph Lauren and the MoMA Design
  Store to my Ginza shopping" is two add_activity, titled "Ralph Lauren Ginza"
  and "MoMA Design Store", each at its own venue and timed one after the other
  inside the stretch the Ginza stop already takes. The title is the place's own
  name and branch, not "Shopping at …".
- "location" is what you would type into Google Maps to land at that venue's
  door: its name, the building or store it is inside, the district and the
  city — "MoMA Design Store, Ginza Loft, Ginza, Tokyo". Never only a district
  or a city for a specific venue; the app looks up the exact street address
  from it. Write a street address only when you were given one. Otherwise null.
- Set named_place true only when the traveller named the venue itself. When
  they asked for a kind of place and you chose it ("add a ramen lunch on Day 2",
  so you picked a shop), it is false. The app asks the traveller which branch
  they meant only for places they named, and trusts your choice for the rest.
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

/**
 * The conversation so far, as the editor reads it: who said it, what kind of
 * message it was, and its words, cut short. Whatever a page sends.
 */
export function editHistory(list) {
  return (Array.isArray(list) ? list : []).slice(-16).map((m) => ({
    role: m && m.role === 'assistant' ? 'Wander' : 'Traveller',
    kind: String((m && m.kind) || 'message').slice(0, 40),
    content: String((m && m.content) || '').trim().slice(0, 700),
  })).filter((m) => m.content);
}

/**
 * A trip's activities, as they come out of the database, in the shape the
 * command bar sends them. The Assistant reads rows; the editor must see the
 * same few fields either way, or the two would answer the same instruction
 * differently.
 */
export function editActivities(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 80).map((a) => ({
    id: a.id,
    day: a.day,
    start_time: a.start_time,
    end_time: a.end_time,
    title: a.title,
    category: a.category,
    // Which kind of journey: the flight matcher re-times only flights.
    subtype: a.category === 'transport' ? a.subtype || null : null,
    location: shortPlace(a.location),
    cost: a.cost,
    // Keys with a leading underscore are the app's own machinery (a journey's
    // arrival pin), coordinates like the ones left out above.
    details: a.details && typeof a.details === 'object'
      ? Object.fromEntries(Object.entries(a.details).filter(([k]) => !k.startsWith('_')))
      : a.details,
    notes: a.category === 'lodging' ? a.notes : undefined,
  }));
}

/** Everything the editor is told, in the order it reads it. */
export function editPrompt({
  trip = {}, activities = [], history = [], instruction, answers = [], calendar = { booked: [], status: 'ready' },
  home = null,
}) {
  const listing = activityListing(activities);

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

  return [
    `Trip: ${trip.name || 'Untitled'}`,
    `Destination: ${trip.destination || 'unspecified'}`,
    `Dates: ${trip.start_date} to ${trip.end_date}`,
    `Currency: ${trip.currency || 'SGD'}`,
    `Destination time zone: ${trip.timezone || 'not set'}`,
    `Budget: ${trip.budget == null ? 'none' : trip.budget}`,
    home ? `Their home: ${home.label}, flying from ${home.airports.join(', ')}` : '',
    dayNames.length ? `Days: ${dayNames.join(', ')}` : '',
    '',
    'Activities (id | day | start–end | title | category | …):',
    listing || '(none yet)',
    '',
    calendarContext(calendar.booked || [], calendar.status || 'ready'),
    '',
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
}

/**
 * What the model answered, made safe to show and to act on: a question with
 * readable options, or edits that only touch activities that exist, in ways
 * the app implements.
 */
export function cleanEdits(out, activities = []) {
  if (!out.understood && out.question) {
    const q = out.question;
    const options = (Array.isArray(q.options) ? q.options : []).slice(0, 4).map((o) => ({
      label: publicAgentText(o && o.label, activities).slice(0, 80),
      detail: publicAgentText(o && o.detail, activities).slice(0, 160),
    })).filter((o) => o.label);
    return {
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
    };
  }

  // Only ever act on activities that exist, and only in ways we implement.
  const known = new Set(activities.map((a) => String(a.id)));
  // An edit's details are checked against what it is: its own category and
  // kind where it sets them, the activity's where it does not.
  const byId = new Map(activities.map((a) => [String(a.id), a]));
  const kindOf = (id, category, subtype) => {
    const was = byId.get(String(id)) || {};
    return [category || was.category, subtype || was.subtype];
  };
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
      details: editDetails(...kindOf(o.activity_id, o.category == null ? null : cleanCategory(o.category),
        cleanSub(o.subtype)), o.details),
      location: o.location == null ? null : String(o.location).slice(0, 300),
      // Whether the traveller chose this venue; only theirs is asked about.
      named_place: o.named_place === true,
      cost: o.cost == null ? null : Math.max(0, Number(o.cost) || 0),
      notes: o.notes == null ? null : String(o.notes).slice(0, 1000),
      trip_name: o.trip_name == null ? null : String(o.trip_name).slice(0, 120),
      destination: o.destination == null ? null : String(o.destination).slice(0, 200),
      start_date: /^\d{4}-\d{2}-\d{2}$/.test(o.start_date || '') ? o.start_date : null,
      end_date: /^\d{4}-\d{2}-\d{2}$/.test(o.end_date || '') ? o.end_date : null,
      timezone: validZone(o.timezone) ? o.timezone : null,
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
          details: editDetails(...kindOf(it.activity_id, null, cleanSub(it.subtype)), it.details),
        } : null
      )).filter(Boolean) : null,
    };
  }).filter(Boolean);

  return {
    understood: true,
    summary: publicAgentText(out.summary, activities).slice(0, 300),
    ops,
  };
}

/**
 * One instruction in, a checked proposal out: `{ understood: false, question }`
 * or `{ understood: true, summary, ops }`, its flights already real. `home`
 * is the traveller's (lib/home.js); `userId` counts their flight searches;
 * `said` is what the traveller wrote themselves, when the instruction is not
 * (the Assistant writes its own), so only their flight numbers are trusted.
 * `ask` is the model call and `match` the flight search, swappable for a test.
 */
export async function proposeEdits({
  instruction, answers = [], trip = {}, activities = [], history = [], calendar, ask = askJson,
  home = null, userId = '', said = null, match,
}) {
  const out = await ask({
    schemaName: 'trip_edits',
    schema: SCHEMA,
    system: SYSTEM,
    task: 'command',
    user: editPrompt({
      trip, activities, history, instruction, answers, calendar, home,
    }),
    maxTokens: 12000,
  });
  const clean = cleanEdits(out || {}, activities);
  if (!clean.understood) return clean;
  return {
    ...clean,
    ops: await findRealFlightsForEdits(clean.ops, {
      activities,
      trip,
      said: said == null ? [instruction, ...answers].join('\n') : said,
      userId,
      ...(match ? { match } : {}),
    }),
  };
}
