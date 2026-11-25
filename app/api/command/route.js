import { aiFailure, aiConfigured, notConfigured } from '@/lib/ai';
import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';
import { commandCalendar } from '@/lib/googleCal';
import { editCalendar } from '@/lib/commandCalendar';
import { requestTiming } from '@/lib/requestTiming';
import { proposeEdits, editHistory } from '@/lib/tripEdits';

/*
 * The command bar's edits. The editor itself — its schema, its rules and the
 * sanitising of what comes back — lives in lib/tripEdits.js, shared with the
 * trip Assistant, which asks it for the same thing when someone asks it to
 * change the plan.
 */

export const runtime = 'nodejs';
/*
 * Editing a whole trip is a minute of work for the model on a long itinerary.
 * Without this a host cuts the request off at its default and the reader sees
 * a failure that was really a deadline.
 */
export const maxDuration = 300;

export async function POST(req) {
  const timing = requestTiming();
  try { return timing.finish(await handleCommand(req, timing)); }
  catch (error) { return timing.finish(aiFailure(error, 'command')); }
}

async function handleCommand(req, timing) {
  if (!aiConfigured()) return notConfigured();
  const user = await timing.measure('auth', () => userFromRequest(req));
  if (!user) return notSignedIn();

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
  // Await a fresh authenticated lookup, not a background UI hook. An empty
  // calendar and a failed lookup must never look the same to the agent.
  const calendar = await editCalendar(
    () => timing.measure('calendar', () => commandCalendar(user.id, trip)),
    instruction,
    answers,
  );
  if (calendar.error) {
    return Response.json({ error: calendar.error.message, code: calendar.error.code }, { status: calendar.error.http });
  }

  try {
    const out = await timing.measure('ai', () => proposeEdits({
      instruction, answers, trip, activities, history: editHistory(body.history), calendar,
    }));
    return Response.json(out);
  } catch (e) {
    return aiFailure(e, 'command');
  }
}
