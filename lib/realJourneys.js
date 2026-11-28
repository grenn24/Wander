/**
 * Making the trains, buses and ferries in new entries real: the fourth shared
 * check, beside real flights (lib/realFlights.js), real stays
 * (lib/realStays.js) and exact places (lib/places.js).
 *
 * Whatever writes a journey writes its two ends and roughly when. This finds
 * both stations, pins the journey where it leaves (with where it arrives,
 * details._arrive, lib/geo.js), and fills in the service itself:
 *
 *   - most of the world: Google's route service at the planned departure
 *     (transitAt, lib/routes.js) — the line, the service number, the stops,
 *     the real departure and arrival from the operator's timetable, and the
 *     fare where Google has one;
 *   - Japan, which Google's API has no transit for: the app's own timetables
 *     and network (railTransit, lib/railTransit.js) — the real lines and a
 *     typical journey time. The exact train is for the day itself, which
 *     Traveller mode gives.
 *
 *   findRealJourneys          entries in, the same entries out (through
 *                             /api/journeys for the pages).
 *   findRealJourneysForEdits  the same for the editor's proposed changes.
 *
 * Timetables reach only as far ahead as operators publish them; beyond that,
 * or for a journey the traveller booked, the stations are pinned and the
 * times stay as written. Never throws.
 */
import { clockAt, instantAt, validZone } from '../public/trip-time.js';
import { nearOwn } from './travel.js';
import { detailKeysFor } from './entryShape.js';
import { money } from './util.js';

export const JOURNEY_KINDS = ['train', 'bus', 'ferry'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const squash = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const toMinutes = (t) => (TIME.test(t || '') ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);

function span(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? ` ${pad(m)}m` : ''}` : `${m}m`;
}

/**
 * The journeys worth a lookup: a train, bus or ferry between two named places
 * on a day. A service number the traveller wrote, or one on a booking, is
 * `trusted`: theirs, so only its stations are pinned.
 */
export function journeysToLookUp(entries, said = '') {
  const heard = squash(said);
  return (Array.isArray(entries) ? entries : []).map((e, index) => {
    if (!e || e.category !== 'transport' || !JOURNEY_KINDS.includes(e.subtype)) return null;
    const d = e.details || {};
    const from = clip(d.from, 120);
    const to = clip(d.to, 120);
    if (!from || !to || !DAY.test(e.day || '')) return null;
    const code = squash(d.code);
    return {
      index,
      kind: e.subtype,
      from,
      to,
      day: e.day,
      time: TIME.test(e.start_time || '') ? e.start_time : null,
      trusted: !!clip(e.booking_ref, 120) || (!!code && heard.includes(code)) || e._trusted === true,
    };
  }).filter(Boolean).slice(0, 6);
}

/** "Kyoto" -> "Kyoto Station" for a train; a bus or a ferry's words as they are. */
export function stationQuery(kind, words) {
  const w = clip(words, 120);
  return kind === 'train' && !/station|駅|bahnhof|hbf|gare|stazione|estaci|terminal/i.test(w) ? `${w} Station` : w;
}

/**
 * Google's answer as the services ridden, in order, each with its stops,
 * local departure and arrival ({ day, time }), and the fare where given.
 */
export function readTimedRoute(route, zone) {
  const legs = [];
  const local = (iso, z) => {
    const ms = Date.parse(iso || '');
    const where = validZone(z) ? z : zone;
    if (!Number.isFinite(ms) || !validZone(where)) return null;
    const c = clockAt(where, new Date(ms));
    return { day: c.day, time: hhmm(c.minutes), ms };
  };
  const point = (stop) => {
    const ll = stop && stop.location && stop.location.latLng;
    return ll && Number.isFinite(ll.latitude) && Number.isFinite(ll.longitude)
      ? { lat: ll.latitude, lng: ll.longitude } : null;
  };
  ((route && route.legs) || []).forEach((leg) => (leg.steps || []).forEach((step) => {
    const t = step && step.transitDetails;
    if (!t) return;
    const s = t.stopDetails || {};
    const line = t.transitLine || {};
    const lv = t.localizedValues || {};
    const departs = local(s.departureTime, lv.departureTime && lv.departureTime.timeZone);
    const arrives = local(s.arrivalTime, lv.arrivalTime && lv.arrivalTime.timeZone);
    if (!departs || !arrives) return;
    legs.push({
      line: clip(line.name || line.nameShort, 80),
      short: clip(line.nameShort, 40),
      agency: clip(line.agencies && line.agencies[0] && line.agencies[0].name, 80),
      trip: clip(t.tripShortText, 30),
      headsign: clip(t.headsign, 80),
      from: clip(s.departureStop && s.departureStop.name, 120),
      to: clip(s.arrivalStop && s.arrivalStop.name, 120),
      fromAt: point(s.departureStop),
      toAt: point(s.arrivalStop),
      departs,
      arrives,
    });
  }));
  const f = route && route.travelAdvisory && route.travelAdvisory.transitFare;
  const fare = f && f.currencyCode
    ? { currency: f.currencyCode, amount: Number(f.units || 0) + Number(f.nanos || 0) / 1e9 } : null;
  return { legs, fare };
}

// Only the fields this kind of journey has (lib/entryShape.js), plus the app's own.
function keep(kind, details) {
  const allowed = new Set(detailKeysFor('transport', kind));
  return Object.fromEntries(Object.entries(details).filter(([k, v]) => (allowed.has(k) || k.startsWith('_')) && v != null && v !== ''));
}

/** A journey pinned at its two ends, found as places; its words are kept. */
export function pinStations(entry, a, b) {
  const d = { ...(entry.details || {}) };
  if (b && Number.isFinite(b.lat)) d._arrive = { q: clip(d.to, 120), lat: b.lat, lng: b.lng };
  return {
    ...entry,
    details: d,
    ...(a && Number.isFinite(a.lat) ? {
      lat: a.lat, lng: a.lng, location: entry.location || a.name || a.label || '',
    } : {}),
  };
}

const TIMETABLE_NOTE = 'Times from the operator\'s timetable as Google had it when the trip was planned; '
  + 'check them before you travel.';

/** A journey with the services Google found, or null when it found none. */
export function journeyWithRoute(entry, timed, { currency = '', booked = false } = {}) {
  const legs = (timed && timed.legs) || [];
  if (!legs.length) return null;
  const kind = entry.subtype;
  const first = legs[0];
  const last = legs[legs.length - 1];
  const name = (l) => l.trip || l.short || l.line || l.agency;
  const ride = legs.map((l, i) => `${name(l)}${l.headsign ? ` towards ${l.headsign}` : ''}${i ? ` from ${l.from}` : ''}`);
  const minutes = Math.round((last.arrives.ms - first.departs.ms) / 60000);
  const fare = timed.fare && timed.fare.currency === currency && timed.fare.amount > 0 ? timed.fare.amount : 0;
  const line = [
    `${ride.join(', then ')}.`,
    span(minutes) ? `${span(minutes)}${legs.length > 1 ? ` with ${legs.length - 1} change${legs.length > 2 ? 's' : ''}` : ''}.` : '',
    fare && !booked ? `Fare about ${money(fare, currency)}.` : '',
    TIMETABLE_NOTE,
  ].filter(Boolean).join(' ');
  const details = keep(kind, {
    ...(entry.details || {}),
    carrier: kind === 'train' ? (first.line || first.agency) : (first.agency || first.line),
    code: name(first),
    from: first.from || (entry.details || {}).from,
    to: last.to || (entry.details || {}).to,
    _arrive: last.toAt ? { q: last.to || (entry.details || {}).to, lat: last.toAt.lat, lng: last.toAt.lng } : (entry.details || {})._arrive,
  });
  return {
    ...entry,
    day: first.departs.day,
    start_time: first.departs.time,
    end_time: last.arrives.time,
    details,
    ...(first.fromAt ? { lat: first.fromAt.lat, lng: first.fromAt.lng, location: first.from || entry.location } : {}),
    ...(fare && !booked ? { cost: fare } : {}),
    notes: [line, clip(entry.notes, 600)].filter(Boolean).join('\n').slice(0, 1000),
  };
}

/**
 * A train in Japan with the lines it really rides and how long it typically
 * takes (lib/railTransit.js), or null. The departure stays as planned; the
 * exact train is the one Traveller mode gives on the day.
 */
export function journeyWithTypical(entry, typical) {
  if (!typical || !typical.found || typical.source === 'walk' || !(typical.lines || []).length) return null;
  const minutes = Math.round((typical.seconds || 0) / 60);
  const start = toMinutes(entry.start_time);
  const names = [...new Set(typical.lines.map((l) => l.name).filter(Boolean))];
  const how = typical.source === 'timetable' ? 'Typical journey from the timetable' : 'Estimated journey';
  const line = `${how}: ${names.join(', then ')}${span(minutes) ? `, about ${span(minutes)}` : ''}. `
    + 'The exact train is the one Traveller mode shows on the day.';
  return {
    ...entry,
    ...(start != null && minutes ? { end_time: hhmm((start + minutes) % 1440) } : {}),
    details: keep(entry.subtype, { ...(entry.details || {}), carrier: names[0] }),
    notes: [line, clip(entry.notes, 600)].filter(Boolean).join('\n').slice(0, 1000),
  };
}

/* The real lookups, loaded only when used, so the tests pass their own. */
async function googleTools() {
  const [{ transitAt, routesKey }, { railTransit }, { searchPlaces, placesKey }] = await Promise.all([
    import('./routes.js'), import('./railTransit.js'), import('./places.js'),
  ]);
  return {
    configured: () => !!placesKey(),
    find: async (q) => {
      const [p] = await searchPlaces(q, 1);
      return p && Number.isFinite(p.lat) ? p : null;
    },
    own: (p) => nearOwn(p),
    typical: ({ from, to }) => railTransit({ from, to }),
    timed: (args) => (routesKey() ? transitAt(args) : null),
  };
}

/**
 * Entries in, `{ entries, found, matched, why }` out. `zone` is the trip's
 * clock, which a planned "09:10" is read in; `tools` is for the tests.
 */
export async function findRealJourneys(list, {
  said = '', currency = '', zone = '', tools = null, now = Date.now(),
} = {}) {
  const entries = (Array.isArray(list) ? list : []).slice();
  const found = entries.map(() => false);
  const done = (why, matched = 0) => ({ entries, found, matched, why });
  const targets = journeysToLookUp(entries, said);
  if (!targets.length) return done(null);
  let use;
  try { use = tools || await googleTools(); } catch (e) {
    console.error('[journeys] lookups failed to load:', e.message);
    return done('error');
  }
  if (!use.configured()) return done('no_key');
  let matched = 0;
  await Promise.all(targets.map(async (t) => {
    try {
      const [a, b] = await Promise.all([use.find(stationQuery(t.kind, t.from)), use.find(stationQuery(t.kind, t.to))]);
      if (!a || !b) return;
      const pinned = pinStations(entries[t.index], a, b);
      entries[t.index] = pinned;
      if (t.trusted) return;
      let real = null;
      if (use.own(a) && use.own(b)) {
        if (t.kind === 'train') real = journeyWithTypical(pinned, await use.typical({ from: a, to: b }));
      } else if (validZone(zone)) {
        const at = instantAt(t.day, t.time || '09:00', zone);
        if (at != null && at > now) {
          const route = await use.timed({ from: a, to: b, departAt: at, kind: t.kind });
          if (route) real = journeyWithRoute(pinned, readTimedRoute(route, zone), { currency });
        }
      }
      if (!real) return;
      entries[t.index] = real;
      found[t.index] = true;
      matched += 1;
    } catch (e) {
      console.error('[journeys] match failed:', e.message);
    }
  }));
  return done(null, matched);
}

/* ------------------------------------------------------ the editor's --- */

const set = (v) => v != null && v !== '';

function describeJourney(verb, e) {
  const d = e.details || {};
  const who = d.code || d.carrier || e.title;
  const fmt = (t) => {
    const m = toMinutes(t);
    if (m == null) return '';
    const h = Math.floor(m / 60);
    return `${h % 12 || 12}${m % 60 ? `:${pad(m % 60)}` : ''}${h < 12 ? 'am' : 'pm'}`;
  };
  return `${verb} ${who}, ${d.from} ${fmt(e.start_time)} to ${d.to} ${fmt(e.end_time)}`.replace(/\s+/g, ' ').trim();
}

/**
 * The editor's operations with their journeys made real: a new train, bus or
 * ferry, and one an edit moves to another day, time or stations. A service
 * already there is theirs when only its day moves. The matched operation
 * carries the station's pin, which the apply step keeps; the traveller's own
 * notes on an existing journey are theirs.
 */
export async function findRealJourneysForEdits(ops, {
  activities = [], trip = {}, said = '', match = findRealJourneys,
} = {}) {
  const list = Array.isArray(ops) ? ops : [];
  try {
    const byId = new Map((activities || []).map((a) => [String(a.id), a]));
    const drafts = [];
    const at = [];
    list.forEach((op, i) => {
      let d = null;
      const det = op.details || {};
      if (op.kind === 'add_activity' && op.category === 'transport' && JOURNEY_KINDS.includes(op.subtype)) {
        d = {
          day: op.day || trip.start_date, title: op.title, start_time: op.start_time, end_time: op.end_time,
          category: 'transport', subtype: op.subtype, details: det, cost: op.cost, notes: op.notes,
          location: op.location, booking_ref: '',
        };
      } else if (op.kind === 'update_activity') {
        const cur = byId.get(String(op.activity_id));
        const subtype = op.subtype || (cur && cur.subtype);
        const moved = set(op.day) || set(op.start_time) || set(det.from) || set(det.to);
        if (cur && moved && (op.category || cur.category) === 'transport' && JOURNEY_KINDS.includes(subtype)) {
          const details = { ...(cur.details || {}), ...Object.fromEntries(Object.entries(det).filter(([, v]) => set(v))) };
          const another = !set(det.code) && (set(op.start_time) || set(det.from) || set(det.to));
          if (another) { delete details.code; delete details.carrier; }
          d = {
            ...cur,
            day: op.day || cur.day,
            start_time: op.start_time || cur.start_time,
            end_time: op.end_time || cur.end_time,
            category: 'transport',
            subtype,
            details,
            _trusted: !another && !!details.code,
          };
        }
      }
      if (d) { drafts.push(d); at.push(i); }
    });
    if (!drafts.length) return list;

    const currency = /^[A-Z]{3}$/.test(trip.currency || '') ? trip.currency : '';
    const { entries, found } = await match(drafts, { said, currency, zone: trip.timezone || '' });
    return list.map((op, i) => {
      const k = at.indexOf(i);
      if (k < 0) return op;
      const e = entries[k];
      const pinned = Number.isFinite(e.lat) && Number.isFinite(e.lng);
      if (!found[k]) {
        // Not matched, but its station found: the apply step need not look it up.
        return pinned && op.kind === 'add_activity'
          ? { ...op, lat: e.lat, lng: e.lng, location: op.location || e.location } : op;
      }
      const { _arrive: ignored, ...details } = e.details || {};
      const real = {
        ...op,
        day: e.day,
        start_time: e.start_time,
        end_time: e.end_time,
        details,
        ...(pinned ? { lat: e.lat, lng: e.lng, location: e.location } : {}),
      };
      if (op.kind !== 'add_activity') return { ...real, describe: describeJourney('Change to', e) };
      return {
        ...real, cost: e.cost == null ? op.cost : e.cost, notes: e.notes, describe: describeJourney('Add', e),
      };
    });
  } catch (e) {
    console.error('[journeys] could not match the edit\'s journeys:', (e && e.message) || e);
    return list;
  }
}
