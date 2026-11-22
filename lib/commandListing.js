import { cleanTime } from './ai.js';

/**
 * How the command bar shows a trip's activities to the model.
 *
 * Every stop is written with its current start AND end, as a clock range.
 * For a long time only the start was sent, as Postgres's "12:00:00", and
 * "make the ramen lunch 30 minutes longer" came back as an end of 12:30 on
 * every model tried. With no end to add the half-hour to, the start was the
 * only clock in sight, so the model read "30 minutes" as the length. The
 * smaller model asked what time lunch ended. It could not have known.
 */

/** A stop's times the way a person reads them: "12:00–13:15". */
export function timesLabel(a) {
  const start = cleanTime(a && a.start_time);
  const end = cleanTime(a && a.end_time);
  if (start && end) return `${start}–${end}`;
  if (start) return `${start}, no end time`;
  if (end) return `ends ${end}, no start time`;
  return 'no time set';
}

/** One line per activity: the fields the model needs, in a fixed order. */
export function activityLine(a) {
  return [
    `id=${a.id}`,
    a.day,
    timesLabel(a),
    a.title,
    a.category,
    a.location ? `at ${a.location}` : '',
    a.details ? `details=${JSON.stringify(a.details)}` : '',
    a.notes ? `notes=${String(a.notes).slice(0, 1000)}` : '',
    a.cost ? `${a.cost}` : '',
  ].filter(Boolean).join(' | ');
}

export function activityListing(activities) {
  return (activities || []).map(activityLine).join('\n');
}
