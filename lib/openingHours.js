import { fmtTime } from './util.js';

/*
 * When a place is open, worked out here from Google's weekly periods rather
 * than read from its `openNow`.
 *
 * The details route is cached at the edge for hours (and served stale for a
 * day after that), so an "open now" carried in the answer can be a day out of
 * date. The periods do not go stale, and the place's offset from UTC turns the
 * reader's clock into the place's.
 *
 * Periods are in the place's own time, days 0–6 from Sunday. One that never
 * closes is a single period opening at Sunday midnight with no close; one that
 * runs past midnight closes on the next day.
 */

const DAY = 1440;
const WEEK = 7 * DAY;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = WEEKDAYS.map((d) => d.slice(0, 3));

const minuteOf = (p) => (Number(p.day) || 0) * DAY + (Number(p.hour) || 0) * 60 + (Number(p.minute) || 0);
const wrap = (t) => ((t % WEEK) + WEEK) % WEEK;

/** The periods as [start, end) minutes of the week; an end may run past the week's. */
export function spans(hours) {
  return ((hours && hours.periods) || []).filter((p) => p && p.open).map((p) => {
    const start = minuteOf(p.open);
    if (!p.close) return [start, start + WEEK];
    let end = minuteOf(p.close);
    if (end <= start) end += WEEK;
    return [start, end];
  });
}

const within = (list, t) => list.some(([a, b]) => (t >= a && t < b) || (t + WEEK >= a && t + WEEK < b));

/** Open at this minute of the place's week, or null where Google gave no hours. */
export function openAt(hours, minuteOfWeek) {
  const list = spans(hours);
  return list.length ? within(list, wrap(minuteOfWeek)) : null;
}

/** The place's own weekday and minute of the day, from its offset from UTC. */
export function placeNow(utcOffsetMinutes, now = Date.now()) {
  const d = new Date(now + (Number(utcOffsetMinutes) || 0) * 60000);
  return { day: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/**
 * Open or shut right now, and when that next changes:
 * { open, always, next: { day, minute, ahead } | null }, `ahead` in minutes.
 * Periods that meet (shut at midnight, open again at midnight) are one
 * stretch, so a place open late is not said to close at twelve.
 */
export function openState(hours, utcOffsetMinutes, now = Date.now()) {
  const list = spans(hours);
  if (!list.length) return null;
  if (list.some(([a, b]) => b - a >= WEEK)) return { open: true, always: true, next: null };
  const { day, minute } = placeNow(utcOffsetMinutes, now);
  const t = day * DAY + minute;
  const open = within(list, t);
  const change = [...new Set(list.flatMap(([a, b]) => [wrap(a), wrap(b)]))]
    .map((e) => ({ e, ahead: wrap(e - t) || WEEK }))
    .sort((x, y) => x.ahead - y.ahead)
    .find(({ e }) => within(list, e) !== open);
  return {
    open,
    always: false,
    next: change ? { day: Math.floor(change.e / DAY), minute: change.e % DAY, ahead: change.ahead } : null,
  };
}

/** A minute of the day as the app writes a time: 9am, 8:30pm. */
export function clock(minute) {
  const m = wrap(minute) % DAY;
  return fmtTime(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}

/** The state in a few words: "Open · closes 8pm", "Closed · opens Mon 11am". */
export function describeOpen(state, today) {
  if (!state) return '';
  if (state.always) return 'Open 24 hours';
  const n = state.next;
  if (!n) return state.open ? 'Open' : 'Closed';
  const when = n.day === today && n.ahead < DAY ? clock(n.minute) : `${SHORT[n.day]} ${clock(n.minute)}`;
  if (state.open) return n.ahead <= 60 ? `Closes soon · ${clock(n.minute)}` : `Open · closes ${when}`;
  return n.ahead <= 60 ? `Opens soon · ${clock(n.minute)}` : `Closed · opens ${when}`;
}

/** One weekday's hours, as written in the week's table: "11am–8pm", "Closed", "Open 24 hours". */
export function dayHours(hours, weekday) {
  const list = spans(hours);
  if (!list.length) return '';
  if (list.some(([a, b]) => b - a >= WEEK)) return 'Open 24 hours';
  const from = weekday * DAY;
  const today = list.filter(([a]) => a >= from && a < from + DAY).sort((x, y) => x[0] - y[0]);
  if (!today.length) return 'Closed';
  return today.map(([a, b]) => `${clock(a)}–${clock(b)}`).join(', ');
}

/** The weekday of a trip day, YYYY-MM-DD, 0 for Sunday. */
export function weekdayOf(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/** Whether a place is open on a trip day at a time (HH:MM), or null where that cannot be said. */
export function openOn(hours, iso, time) {
  const day = weekdayOf(iso);
  if (day == null || !time) return null;
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  return openAt(hours, day * DAY + h * 60 + (m || 0));
}
