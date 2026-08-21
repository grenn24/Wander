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
 * The model for one task.
 *
 * The four call sites want opposite things: planning a trip is streamed, so
 * latency is hidden and quality is all that matters, while parsing a line the
 * reader just typed is the reverse. Each can be pointed at its own model with
 * OPENAI_MODEL_<TASK>; anything unset falls back to OPENAI_MODEL, so a single
 * variable still configures everything.
 */
export function aiModel(task) {
  const perTask = task && process.env[`OPENAI_MODEL_${task.toUpperCase()}`];
  return perTask || process.env.OPENAI_MODEL || 'gpt-5-mini';
}

/**
 * Optional reasoning budget, per task. Reasoning models think before answering,
 * which is worth paying for on a whole itinerary and mostly wasted turning one
 * sentence into five fields. Only sent when configured — models that do not
 * accept the parameter reject the request outright.
 */
export function aiEffort(task) {
  const v = task && process.env[`OPENAI_EFFORT_${task.toUpperCase()}`];
  return ['minimal', 'low', 'medium', 'high'].includes(v) ? v : '';
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
        + 'Set OPENAI_MODEL (or the per-task override) to one you do have.');
    }
    throw new Error(detail || `OpenAI returned ${res.status}.`);
  }

  const body = await res.json();
  const text = body.choices && body.choices[0] && body.choices[0].message
    && body.choices[0].message.content;
  if (!text) throw new Error('OpenAI returned an empty response.');

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
