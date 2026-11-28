/**
 * The flights of a planned trip, between the page that finds them and the
 * route that plans around them. Pure, so the page, the route and the tests
 * share one copy.
 *
 * The way there and the way home are found before the plan is written
 * (app/api/flights, mode 'trip'), because they decide what the first and last
 * days can hold: a flight that lands at 16:40 leaves no morning in Tokyo. The
 * page sends them to /api/plan as `fixed`, the model is told them as facts and
 * told not to write them, and the page adds the real legs to the trip itself.
 * Flights inside the trip (Tokyo to Sapporo) are the model's to place, and
 * are made real afterwards by the service every way of making entries shares
 * (matchFlights, lib/flightMatch.js).
 */

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const code3 = (v) => {
  const c = clip(v, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : '';
};

/** Day 1 is `start`. */
export function dayIndexOf(start, day) {
  if (!DAY.test(start || '') || !DAY.test(day || '')) return 0;
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

function cleanLeg(l) {
  if (!l || typeof l !== 'object') return null;
  const d = l.details && typeof l.details === 'object' ? l.details : l;
  const from = code3(d.from);
  const to = code3(d.to);
  if (!from || !to || !DAY.test(l.day || '')) return null;
  return {
    day: l.day,
    start_time: TIME.test(l.start_time || '') ? l.start_time : null,
    end_time: TIME.test(l.end_time || '') ? l.end_time : null,
    carrier: clip(d.carrier, 80),
    code: clip(d.code, 10),
    from,
    to,
    arrival_date: DAY.test(d.arrival_date || '') ? d.arrival_date : null,
  };
}

/**
 * What /api/plan accepts as `fixed`, and nothing else. It comes from the
 * page, so it is read as carefully as anything else a request carries.
 */
export function cleanFixed(v) {
  if (!v || typeof v !== 'object' || !DAY.test(v.start_date || '')) return null;
  const days = Math.min(30, Math.max(1, Math.round(Number(v.duration_days) || 0)));
  if (!days) return null;
  const flights = (Array.isArray(v.flights) ? v.flights : []).slice(0, 2).map((f) => {
    const legs = (Array.isArray(f && f.legs) ? f.legs : []).slice(0, 4).map(cleanLeg).filter(Boolean);
    return legs.length ? { kind: f.kind === 'return' ? 'return' : 'outbound', legs } : null;
  }).filter(Boolean);
  return {
    start_date: v.start_date,
    duration_days: days,
    currency: /^[A-Z]{3}$/.test(v.currency || '') ? v.currency : null,
    home: clip(v.home, 60),
    home_airports: (Array.isArray(v.home_airports) ? v.home_airports : [])
      .map(code3).filter(Boolean).slice(0, 4),
    flights,
  };
}

/** The legs of found flights, as the page keeps them, in the shape `fixed` wants. */
export function fixedFlights(flights) {
  return (Array.isArray(flights) ? flights : []).map((f) => ({
    kind: f.kind,
    legs: (f.legs || []).map((r) => ({
      day: r.day, start_time: r.start_time, end_time: r.end_time, details: r.details,
    })),
  }));
}

function legLine(start, l) {
  const n = dayIndexOf(start, l.day);
  const who = [l.carrier, l.code].filter(Boolean).join(' ');
  if (!l.start_time) {
    return `- Day ${n}, ${l.day}: a flight from ${l.from} to ${l.to}; its times are not known yet.`;
  }
  return `- Day ${n}, ${l.day}: ${who || 'a flight'} from ${l.from} at ${l.start_time}, `
    + `landing at ${l.to} at ${l.end_time || 'an unknown time'}${l.arrival_date ? ` on ${l.arrival_date}` : ''}.`;
}

/** The dates and flights, as the planner is told them. */
export function fixedBlock(fixed) {
  if (!fixed) return '';
  const end = new Date(Date.parse(`${fixed.start_date}T00:00:00Z`) + (fixed.duration_days - 1) * 86400000)
    .toISOString().slice(0, 10);
  const lines = [
    '',
    `The trip runs from ${fixed.start_date} for ${fixed.duration_days} day${fixed.duration_days === 1 ? '' : 's'}`
      + `${fixed.duration_days > 1 ? `, so the last day is ${end}` : ''}. Use exactly these dates.`,
  ];
  if (fixed.currency) lines.push(`Write every cost in ${fixed.currency}.`);
  const legs = fixed.flights.flatMap((f) => f.legs);
  if (!legs.length) return lines.join('\n');
  const home = fixed.home || 'home';
  lines.push(
    '',
    `Their flights to and from ${home}, already chosen from real schedules. The app adds`,
    `them to the itinerary itself: do not write them, or any other flight to or from ${home},`,
    'as activities. Plan the days around them; every time is local to its airport.',
    ...legs.map((l) => legLine(fixed.start_date, l)),
    'After landing, allow about an hour and a half to clear the airport and reach the city',
    'before anything else is planned. On the day home, plan nothing in the three hours',
    'before an international departure (two for a domestic one), and nothing after it.',
  );
  if (legs.some((l) => !l.start_time)) {
    lines.push('Where a flight\'s times are not known, keep its day light: start the first',
      'day in the late afternoon, and end the last day by late morning.');
  }
  return lines.join('\n');
}

/**
 * Whether an activity the model wrote is one of the flights the app adds.
 *
 * It is told not to write them and sometimes does anyway, and a trip with two
 * flights to Tokyo on day 1 is worse than one with none. Anything that flies
 * to or from a home airport is the app's; so is a flight on one of the days
 * the app flies, between the same airports or with no airports at all, or one
 * whose title says it goes home.
 */
export function isHomeFlight(a, fixed, dayIndex) {
  if (!fixed || !fixed.flights || !fixed.flights.length || !a || a.category !== 'transport') return false;
  const title = String(a.title || '');
  if (a.subtype !== 'flight' && !/\b(flight|fly|flying)\b/i.test(title)) return false;
  if (a.subtype && a.subtype !== 'flight') return false;
  const d = a.details || {};
  const from = code3(d.from);
  const to = code3(d.to);
  const homes = new Set(fixed.home_airports || []);
  fixed.flights.forEach((f) => {
    const legs = f.legs || [];
    if (!legs.length) return;
    if (f.kind === 'return') homes.add(legs[legs.length - 1].to);
    else homes.add(legs[0].from);
  });
  if (homes.has(from) || homes.has(to)) return true;
  const days = new Set(fixed.flights.flatMap((f) => f.legs.map((l) => dayIndexOf(fixed.start_date, l.day))));
  if (!days.has(dayIndex)) return false;
  const ours = new Set(fixed.flights.flatMap((f) => f.legs.flatMap((l) => [l.from, l.to])));
  if (from && to && ours.has(from) && ours.has(to)) return true;
  const word = String(fixed.home || '').toLowerCase();
  if (word && title.toLowerCase().includes(word)) return true;
  if (/\bflight\s+(home|back)\b/i.test(title)) return true;
  return !from && !to;
}
