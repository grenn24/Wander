/**
 * Picking a plan up where its stream stopped.
 *
 * A trip is written as one long answer, a minute or more of it, and the
 * connection carrying it does not always last that long. On 28 November 2026
 * two fourteen-day plans stopped on production at day 12 and at day 5: the
 * server wrote the whole itinerary, but the browser stopped hearing it part
 * way, and the page waited on a stream that would never say anything again.
 *
 * So the page keeps what has arrived, and when the stream stops it asks for
 * the rest: a new request, with a fresh time budget, that is told which days
 * are already written and writes the ones after. The last day that arrived is
 * written again, because there is no telling whether it was finished.
 */

/** How many times a plan is picked up before the page gives up and says so. */
export const RESUME_LIMIT = 6;

/*
 * The server says something at least this often, even while the model is
 * still thinking; a page that hears nothing for QUIET_MS knows the connection
 * has gone, rather than waiting on it for ever.
 */
export const BEAT_MS = 10_000;
export const QUIET_MS = 40_000;

/*
 * The server gives up on an answer that has stopped growing: nothing new for
 * PLAN_QUIET_MS once days are arriving (a day took about five seconds when
 * measured), or nothing at all for PLAN_FIRST_MS while the model thinks.
 */
export const PLAN_FIRST_MS = 90_000;
export const PLAN_QUIET_MS = 30_000;

/**
 * Where to carry on from, given the days drafted so far
 * (`[{ index, theme, activities }]`, the page's own shape).
 *
 * `from` is the last day that arrived — written again, as it may be half
 * done — and `kept` is every day before it.
 */
export function resumePoint(days) {
  const sorted = (Array.isArray(days) ? days : [])
    .filter((d) => d && Number.isInteger(d.index) && d.index >= 1)
    .slice()
    .sort((a, b) => a.index - b.index);
  if (!sorted.length) return { from: 1, kept: [] };
  const from = sorted[sorted.length - 1].index;
  return { from, kept: sorted.filter((d) => d.index < from) };
}

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/**
 * What the planner is told about the trip so far: enough to carry on in the
 * right city without repeating a museum, and small — a title, a time and a
 * place for each stop, not the notes.
 */
export function resumeBrief(meta, kept, from) {
  const m = meta || {};
  return {
    from,
    name: clip(m.name, 120),
    destination: clip(m.destination, 200),
    currency: clip(m.currency, 3),
    duration_days: Number(m.duration_days) || 0,
    summary: clip(m.summary, 500),
    days: (kept || []).map((d) => ({
      day_index: d.index,
      theme: clip(d.theme, 120),
      activities: (d.activities || []).map((a) => ({
        title: clip(a.title, 120),
        start_time: a.start_time || null,
        location: clip(a.location, 160),
      })),
    })),
  };
}

/**
 * The same, read on the server from a request body — which anyone can send,
 * so every field is checked and cut to size. Null when it is not a resume.
 */
export function readResume(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const from = Number(raw.from);
  if (!Number.isInteger(from) || from < 1 || from > 30) return null;
  const days = (Array.isArray(raw.days) ? raw.days : []).slice(0, 30)
    .filter((d) => d && Number.isInteger(Number(d.day_index))
      && Number(d.day_index) >= 1 && Number(d.day_index) < from)
    .map((d) => ({
      day_index: Number(d.day_index),
      theme: clip(d.theme, 120),
      activities: (Array.isArray(d.activities) ? d.activities : []).slice(0, 8).map((a) => ({
        title: clip(a && a.title, 120),
        start_time: /^\d{2}:\d{2}$/.test(a && a.start_time) ? a.start_time : null,
        location: clip(a && a.location, 160),
      })),
    }));
  return {
    from,
    name: clip(raw.name, 120),
    destination: clip(raw.destination, 200),
    currency: /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : '',
    duration_days: Math.min(30, Math.max(0, Number(raw.duration_days) || 0)),
    summary: clip(raw.summary, 500),
    days,
  };
}

/** The instruction appended to the traveller's request when picking up. */
export function resumeInstruction(resume) {
  const { from, days, ...meta } = resume;
  const last = meta.duration_days ? `day ${meta.duration_days}` : 'the last day';
  return [
    '',
    '',
    'You already began this plan and were cut off. This is what you had written',
    'before day ' + from + ' — it is kept exactly as it is:',
    JSON.stringify({ ...meta, days }),
    '',
    `Answer again with the same name, destination, currency, duration and summary,`
      + ` and the same start date and time zone. In "days", write only day ${from}`
      + ` through ${last}: the days above are already kept, so do not repeat them.`
      + (days.length
        ? ` Carry on from where day ${from - 1} left the traveller, and do not repeat`
          + ' a place already visited unless the plan needs it.'
        : ''),
  ].join('\n');
}

/**
 * Reads one planner response body to its end, handing each meta, day and act
 * event to `onEvent` as it arrives. Resolves with one of
 *
 *   { plan }    the finished plan arrived
 *   { error }   the server said it failed, and said why
 *   { cut }     the stream stopped first — it ended, broke, or went quiet for
 *               `quietMs` — and the plan can be picked up from what arrived
 *
 * It throws only when `signal` (the traveller's Cancel) was aborted. Every
 * other way a stream can stop is a cut, because the page used to treat any
 * abort as a cancel and return without a word, leaving the train running over
 * a plan that was never coming.
 */
export async function readPlan(body, { onEvent = () => {}, quietMs = QUIET_MS, signal = null } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let cut = '';
  let quiet = false;
  let timer = null;
  const listen = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      quiet = true;
      // Resolves the pending read as done.
      reader.cancel().catch(() => {});
    }, quietMs);
  };

  try {
    listen();
    for (;;) {
      let step;
      try {
        // eslint-disable-next-line no-await-in-loop
        step = await reader.read();
      } catch (e) {
        if (signal && signal.aborted) throw e;
        return { cut: 'dropped' };
      }
      if (step.done) break;
      listen();
      buf += decoder.decode(step.value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt;
        try { evt = JSON.parse(line); } catch (e) { continue; }
        // Nothing useful comes after it, so the close is not waited for.
        if (evt.t === 'done' && evt.plan) return { plan: evt.plan };
        if (evt.t === 'error') return { error: evt.error || 'Planning failed.' };
        else if (evt.t === 'cut') cut = String(evt.why || 'cut');
        else if (evt.t !== 'wait') onEvent(evt);
      }
    }
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
  if (signal && signal.aborted) throw new DOMException('Planning was cancelled.', 'AbortError');
  return { cut: quiet ? 'quiet' : (cut || 'ended') };
}

/**
 * The finished plan: the trip as the first answer described it, the kept days
 * as they arrived, and the rest from the answer that picked it up.
 */
export function mergeResumed(meta, kept, plan, from) {
  const m = meta || {};
  return {
    ...plan,
    name: m.name || plan.name,
    destination: m.destination || plan.destination,
    // Every cost already shown was in this currency.
    currency: /^[A-Z]{3}$/.test(m.currency || '') ? m.currency : plan.currency,
    duration_days: Number(m.duration_days) || plan.duration_days,
    summary: m.summary || plan.summary,
    days: [
      ...(kept || []).map((d) => ({ day_index: d.index, theme: d.theme || '', activities: d.activities || [] })),
      ...(plan.days || []).filter((d) => Number(d.day_index) >= from),
    ],
  };
}
