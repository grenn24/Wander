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
 * The four call sites want opposite things, so they are not configured alike.
 * These are engineering decisions rather than deployment settings — they do not
 * vary between a laptop and production — so they live here, versioned and
 * reviewable, instead of in the environment where they could silently drift.
 *
 *   model   null means "whatever OPENAI_MODEL says", which is the one knob that
 *           genuinely varies, since account access differs.
 *   effort  reasoning budget. Worth paying for on a whole itinerary, mostly
 *           wasted turning one sentence into five fields.
 */
const TASKS = {
  // Streamed, so the reader never sits watching a spinner: spend it on quality.
  // The only task where deep reasoning earns its cost.
  plan: { model: null, effort: null },
  // Typed mid-sentence. Minimal effort took this from ~10s to ~2s.
  parse: { model: null, effort: 'minimal' },
  // Judgement, but shallow: fit a few ideas around what is already there.
  suggest: { model: null, effort: 'low' },
  // Recall, essentially. Left at default effort it burned its entire budget
  // thinking and returned nothing at all.
  packing: { model: null, effort: 'low' },
};

const EFFORTS = ['minimal', 'low', 'medium', 'high'];

export function aiModel(task) {
  const perTask = task && TASKS[task] && TASKS[task].model;
  return perTask || process.env.OPENAI_MODEL || 'gpt-5-mini';
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

/** The shape route handlers return when the key has not been filled in yet. */
export function notConfigured() {
  return Response.json({
    error: 'AI planning is not configured yet. Set OPENAI_API_KEY in .env.local '
      + '(or in your host\'s environment variables) and restart the server.',
    code: 'no_key',
  }, { status: 503 });
}

/**
 * One structured-output call. `schema` must be a strict JSON Schema: every
 * property required, additionalProperties false — OpenAI rejects anything else
 * in strict mode, and strict mode is what makes the result safe to trust.
 */
export async function askJson({ system, user, schema, schemaName, maxTokens = 4000, task }) {
  const effort = aiEffort(task);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: aiModel(task),
      max_completion_tokens: maxTokens,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [
        { role: 'system', content: system },
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
  const choice = (body.choices && body.choices[0]) || {};
  const text = choice.message && choice.message.content;

  if (!text) {
    // On reasoning models max_completion_tokens covers the thinking as well as
    // the answer, so a budget that looks generous can be spent entirely before
    // a single output token is written. That arrives as finish_reason "length"
    // with empty content, which reads like a mystery unless it is named.
    const used = (body.usage && body.usage.completion_tokens_details
      && body.usage.completion_tokens_details.reasoning_tokens) || 0;
    if (choice.finish_reason === 'length') {
      throw new Error(`The model spent its whole budget thinking (${used} reasoning `
        + `tokens of ${maxTokens}) and produced nothing. Raise maxTokens for this `
        + 'route, or lower its effort in the TASKS table.');
    }
    throw new Error(`OpenAI returned no content (finish_reason: ${choice.finish_reason || 'unknown'}).`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('OpenAI returned something that was not valid JSON.');
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
