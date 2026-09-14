/*
 * OpenAI for the journey service.
 *
 * The app's own routes use chat completions because someone is waiting. This
 * runs where nobody is: the best model, high effort, and web search so facts
 * that change — closures, access rules, tickets — are checked against today
 * rather than recalled from training.
 *
 * Requests run in background mode and are polled. A high-effort answer with
 * several searches can take longer than an HTTP connection will stay open,
 * and a timeout halfway through would pay for the work and keep none of it.
 */
const BASE = 'https://api.openai.com/v1/responses';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export const MODEL = () => process.env.OPENAI_MODEL_JOURNEYS || 'gpt-5.5';
export const EFFORT = () => process.env.OPENAI_EFFORT_JOURNEYS || 'high';

function key() {
  const k = process.env.OPENAI_API_KEY || '';
  if (!k || k.startsWith('REPLACE_WITH')) throw new Error('OPENAI_API_KEY is not set.');
  return k;
}

async function call(url, init, label) {
  let wait = 5000;
  for (let attempt = 1; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      if (attempt < 5) { await sleep(wait); wait *= 2; continue; }
      throw new Error(`${label}: ${e.message}`);
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const message = (body.error && body.error.message) || `OpenAI returned ${res.status}`;
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(wait); wait *= 2; continue; }
    const err = new Error(`${label}: ${message}`);
    err.status = res.status;
    throw err;
  }
}

/**
 * One structured answer. Returns { data, sources, usage, searches }.
 */
export async function respond({ name, schema, instructions, input, effort = EFFORT(), search = true, maxOutput = 60000 }) {
  const request = {
    model: MODEL(),
    instructions,
    input,
    reasoning: { effort },
    max_output_tokens: maxOutput,
    ...(search ? { tools: [{ type: 'web_search' }] } : {}),
    text: { format: { type: 'json_schema', name, strict: true, schema } },
    background: true,
  };
  let job = await call(BASE, { method: 'POST', body: JSON.stringify(request) }, name);
  const started = Date.now();
  while (job.status === 'queued' || job.status === 'in_progress') {
    if (Date.now() - started > 40 * 60 * 1000) throw new Error(`${name}: still running after 40 minutes`);
    await sleep(4000);
    job = await call(`${BASE}/${job.id}`, { method: 'GET' }, name);
  }
  if (job.status !== 'completed') {
    const why = (job.error && job.error.message) || (job.incomplete_details && job.incomplete_details.reason) || job.status;
    throw new Error(`${name}: ${why}`);
  }
  const parts = (job.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []);
  const text = parts.map((c) => c.text || '').join('');
  const sources = parts.flatMap((c) => (c.annotations || [])
    .filter((a) => a.type === 'url_citation' && a.url)
    .map((a) => ({ title: a.title || '', url: a.url })));
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`${name}: the answer was not complete JSON`);
  }
  return {
    data,
    sources,
    usage: job.usage || {},
    searches: (job.output || []).filter((o) => o.type === 'web_search_call').length,
  };
}
