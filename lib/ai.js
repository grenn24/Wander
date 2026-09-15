/**
 * Server-side OpenAI helper. Imported only by route handlers under app/api/ —
 * never by a client component, because OPENAI_API_KEY is a real secret. The
 * browser talks to our own routes, and only those talk to OpenAI.
 *
 * Uses plain fetch rather than the SDK: one dependency fewer, and structured
 * outputs are the only feature needed.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * Per-task tuning.
 *
 * The call sites want opposite things, so they are not configured alike. These
 * are engineering decisions rather than deployment settings — they do not vary
 * between a laptop and production — so they live here, versioned and
 * reviewable, instead of in the environment where they could silently drift.
 *
 *   tier    which model. Every task used to run on the same one, which meant
 *           the itinerary — the thing people come here for, and wait a minute
 *           for — was thinking no harder than the box that turns "9am senso-ji"
 *           into five fields.
 *   effort  reasoning budget, within that model.
 *
 * Two tiers rather than a model name per task. A name per task is a promise
 * about an account's access that this file cannot keep, and seven of them go
 * stale together the first time a model is retired. Two names in the
 * environment, and the split between them argued for here.
 */
const TIERS = {
  // Everything that happens while someone is typing, or is mostly recall.
  fast: () => process.env.OPENAI_MODEL || 'gpt-5-mini',
  /*
   * The two that are worth waiting for. Named here rather than in the
   * environment: which model plans a trip is a decision about the product, and
   * it should change in a reviewed commit, not silently between deployments.
   */
  smart: () => 'gpt-5.5',
};
const TASKS = {
  /*
   * The thing people come here for. Streamed, so the days appear as they are
   * written — but the wait to the *last* day still counts, and at default
   * effort a six-day trip took a minute.
   *
   * So: the better model, at low effort. The schema does most of the work
   * here rather than the deliberation, and the difference a stronger model
   * makes to "is this a real place, is that a sensible order, does this note
   * say anything" is larger than the difference more thinking makes.
   */
  plan: { tier: 'smart', effort: 'low' },
  // A short check before planning. It decides whether missing information is
  // important enough to interrupt for, so speed matters more than depth.
  brief: { tier: 'fast', effort: 'minimal' },
  // Typed mid-sentence. Minimal effort took this from ~10s to ~2s.
  parse: { tier: 'fast', effort: 'minimal' },
  // Judgement, but shallow: fit a few ideas around what is already there.
  suggest: { tier: 'fast', effort: 'low' },
  // Recall, essentially. Left at default effort it burned its entire budget
  // thinking and returned nothing at all.
  packing: { tier: 'fast', effort: 'low' },
  /*
   * Editing a whole trip: real work, on the better model. Every edit is shown
   * before it is saved, so a mistake here costs a glance rather than a trip —
   * but a misread instruction across forty activities is a lot of glancing.
   * Still low effort: someone is waiting, and reviewing.
   */
  command: { tier: 'smart', effort: 'low' },
  // Working out which dates a request is about, before anything is planned.
  // One sentence in, two fields out, and a whole plan waiting behind it.
  when: { tier: 'fast', effort: 'minimal' },
  // Ranking a handful of verified Google candidates, not inventing a place.
  place: { tier: 'fast', effort: 'minimal' },
  // Reading a picture. Mostly perception rather than thought, and it runs
  // before the planner does — so every second here is a second added to a wait
  // that has not started yet.
  vision: { tier: 'fast', effort: 'low' },
  /*
   * A question asked mid-read about a journey. Streamed, and someone is
   * waiting with the page open, so low effort; the better model, because a
   * confident wrong answer about a closure or a permit is worse than a slow one.
   */
  ask: { tier: 'smart', effort: 'low' },
};

const EFFORTS = ['minimal', 'low', 'medium', 'high'];

export function aiModel(task) {
  const tier = (task && TASKS[task] && TASKS[task].tier) || 'fast';
  return (TIERS[tier] || TIERS.fast)();
}

/**
 * Only ever returns a value this API accepts: a model that does not support
 * reasoning_effort rejects the whole request, so a bad value here would take
 * down the feature rather than be ignored.
 */
export function aiEffort(task) {
  const v = task && TASKS[task] && TASKS[task].effort;
  return EFFORTS.includes(v) ? v : '';
}

export function aiConfigured() {
  const k = process.env.OPENAI_API_KEY || '';
  return !!k && !k.startsWith('REPLACE_WITH');
}

/**
 * What a reader sees when anything upstream goes wrong.
 *
 * The cause is ours to fix, not theirs to read: budgets, model names, key
 * problems and TLS failures mean nothing to someone planning a holiday, and
 * spelling out our configuration to a stranger is worse than saying nothing.
 * The detail goes to the server log, where an operator will actually find it.
 */
const GENERIC = 'Something went wrong on our end. Please try again.';

/** The shape route handlers return when the key has not been filled in yet. */
export function notConfigured() {
  console.error('[ai] OPENAI_API_KEY is not set — the AI routes are disabled. '
    + 'Set it in .env.local (or your host\'s environment) and restart.');
  return Response.json({
    error: 'Smart planning is switched off right now.',
    code: 'no_key',
  }, { status: 503 });
}

/** Log why it broke, tell the reader only that it did. */
export function aiFailure(e, task) {
  console.error(`[ai] ${task} failed:`, (e && e.message) || e);
  // Running out of room is the one failure the reader can actually do
  // something about, so it gets a real answer instead of the shrug.
  if (e && e.code === 'too_long') {
    return Response.json({
      error: 'That is a bigger change than I can work out in one go. '
        + 'Try it a day or two at a time.',
      code: 'too_long',
    }, { status: 502 });
  }
  return Response.json({ error: GENERIC }, { status: 502 });
}

/** Never let a retry run away with the bill. */
const CEILING = 48000;

/** Thrown when the model ran out of room rather than out of ideas. */
export class TooLong extends Error {
  constructor(message) {
    super(message);
    this.name = 'TooLong';
    this.code = 'too_long';
  }
}

async function once({ system, user, schema, schemaName, budget, task }) {
  const effort = aiEffort(task);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: aiModel(task),
      max_completion_tokens: budget,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [
        { role: 'system', content: system },
        // A string for everything that is only words; an array of parts when
        // there is a picture to look at as well.
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = (body.error && body.error.message) || '';
    } catch (e) { /* non-JSON error body */ }

    if (res.status === 401) throw new Error('OpenAI rejected the API key. Check OPENAI_API_KEY.');
    if (res.status === 429) throw new Error('OpenAI is rate limiting or the account is out of quota.');
    if (/model/i.test(detail) && /(not exist|not found|access)/i.test(detail)) {
      throw new Error(`Your account cannot use "${aiModel(task)}". `
        + 'Set OPENAI_MODEL to one you do have.');
    }
    throw new Error(detail || `OpenAI returned ${res.status}.`);
  }

  const body = await res.json();
  const usage = body.usage || {};
  const reasoning = (usage.completion_tokens_details
    && usage.completion_tokens_details.reasoning_tokens) || 0;
  const spent = usage.completion_tokens || 0;

  // How much of the cap each task actually uses, so the ceilings stay sized on
  // evidence rather than guesswork. Reasoning is the half that surprises.
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[ai] ${task}: in ${usage.prompt_tokens || 0} · reasoning ${reasoning}`
      + ` + output ${spent - reasoning} = ${spent} of ${budget}`);
  }

  const choice = (body.choices && body.choices[0]) || {};
  const text = choice.message && choice.message.content;

  // Two different ways to hit the ceiling, and both arrive as "length": the
  // model spent the whole budget reasoning and wrote nothing, or it wrote a
  // long answer and was cut off mid-JSON. Either way the fix is more room.
  if (choice.finish_reason === 'length') {
    throw new TooLong(`hit the ${budget} ceiling after ${reasoning} reasoning tokens`
      + `${text ? ' with the answer cut short' : ' and produced nothing'}`);
  }
  if (!text) {
    throw new Error(`OpenAI returned no content (finish_reason: ${choice.finish_reason || 'unknown'}).`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    // Valid JSON is guaranteed unless the response was truncated, so this is
    // the same problem wearing a different hat.
    throw new TooLong('the answer was not complete JSON');
  }
}

/**
 * One structured-output call. `schema` must be a strict JSON Schema: every
 * property required, additionalProperties false — OpenAI rejects anything else
 * in strict mode, and strict mode is what makes the result safe to trust.
 *
 * Running out of room gets one retry at double the budget. A ceiling has to be
 * set from guesswork about the largest request anyone will make, and that
 * guess is wrong in one of two expensive directions: too low and a legitimate
 * request fails, too high and every small request reserves room it never uses.
 * Asking again with more room only costs anything in the rare case that needs
 * it — and a big edit to a long trip is exactly the request worth finishing.
 */
export async function askJson({ system, user, schema, schemaName, maxTokens = 8000, task }) {
  let budget = Math.min(maxTokens, CEILING);

  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await once({ system, user, schema, schemaName, budget, task });
    } catch (e) {
      const room = budget < CEILING;
      if (!(e instanceof TooLong) || attempt >= 1 || !room) throw e;
      budget = Math.min(budget * 2, CEILING);
      console.warn(`[ai] ${task}: ${e.message} — retrying with ${budget}`);
    }
  }
}
/** Categories the app understands. Anything else gets mapped to "other". */
export const AI_CATEGORIES = [
  'sightseeing', 'food', 'transport', 'lodging', 'activity', 'shopping', 'other',
];

export const PACKING_GROUPS = [
  'general', 'clothes', 'tech', 'documents', 'toiletries', 'meds',
];

/** Guards against a model inventing a category or a malformed time. */
export function cleanCategory(c) {
  return AI_CATEGORIES.includes(c) ? c : 'other';
}

export function cleanTime(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
