/**
 * Where a day has got to, by the clock.
 *
 * Two screens need this and they must never disagree: the itinerary marks the
 * activity you are in the middle of, and Traveller mode shows it. One of them
 * saying you are at dinner while the other says you are on a train would be
 * worse than neither saying anything.
 */

/** Minutes since midnight, from the clock rather than from the plan. */
export function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function toMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

/** "in 25 min", "in 2h 10m" — how long until something starts. */
export function until(mins) {
  if (mins == null || mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/**
 * What is happening, and what is next.
 *
 * An activity with an end time is over when that time passes. One without an
 * end time runs until the next thing starts, and if it is the last of the day,
 * until the day is out — because the plan forgetting to say when dinner ends
 * does not mean dinner ends immediately, and does not mean it is still going
 * tomorrow morning either.
 */
export function readDay(list, at) {
  const timed = list
    .filter((a) => toMinutes(a.start_time) != null)
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

  let now = null;
  let next = null;

  timed.forEach((a, i) => {
    const from = toMinutes(a.start_time);
    const after = timed[i + 1] ? toMinutes(timed[i + 1].start_time) : 24 * 60;
    const to = toMinutes(a.end_time) ?? after;
    if (from <= at && to > at) now = a;
    else if (from > at && !next) next = a;
  });

  // Nothing has a time on it, so the first thing on the list is the plan.
  if (!now && !next && !timed.length) next = list[0] || null;
  return { now, next };
}
