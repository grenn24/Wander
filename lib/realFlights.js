/**
 * Making the flights in new entries real: one service for every way an entry
 * is made.
 *
 * Whatever writes a flight — the planner, the command bar, the Assistant,
 * quick add — writes what a model knows, which is the two airports and roughly
 * when. This swaps each one for the real flight on that day: the airline, the
 * number, the local times, both airports' zones and the fare, a leg each for
 * a connection. Places work the same way (lib/places.js behind
 * /api/places/resolve), and this sits beside them:
 *
 *   findRealFlights  drafts in, the same drafts out with flights made real.
 *                 Called in the server by the trip editor (findRealFlightsForEdits, from
 *                 lib/tripEdits.js), so a proposal shows the real flight before
 *                 anyone approves it; and through /api/flights (mode 'legs')
 *                 by the pages that make entries in the browser
 *                 (checkNewEntries in lib/entryChecks.js).
 *   findRealFlightsForEdits     the same, for the editor's operations: a new flight, or a
 *                 flight whose day, time or airports an edit changes.
 *
 * Never throws: a flight that cannot be matched stays as it was written.
 */
import { airports, airportOf, knownCodes, airportsNamed } from './airports.js';
import {
  flightsConfigured, searchOffers, pickOffer, offerActivities,
} from './flights.js';
import { fmtTime } from './util.js';
import { spendSearches } from './serpApi.js';

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const squash = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/*
 * Hints a caller can put on a draft, read here and never saved:
 *   _from, _to   every airport to search from and to ("LHR,LGW,LTN"), where
 *                details.from and .to hold only the one written on the entry;
 *   _kind        'outbound' or 'return' for the flights there and home, which
 *                are chosen differently from one inside the trip (pickOffer);
 *   _trusted     the number on it is the traveller's own (see flightsToLookUp).
 */
const HINTS = ['_from', '_to', '_kind', '_trusted'];
function withoutHints(d) {
  if (!d || typeof d !== 'object') return d;
  const out = { ...d };
  HINTS.forEach((k) => { delete out[k]; });
  return out;
}

/**
 * The flights among some drafts worth a search: every flight between two
 * places, with the time it was given (a real flight near that time keeps the
 * day as planned) and, where one was written, its number. A number the
 * traveller wrote themselves (`said`), one on a booking, or one marked
 * `_trusted` (a flight an edit only moves to another day, or one they named
 * for the way there) is `trusted`: that flight or nothing. A number only a
 * model wrote is a hint.
 */
export function flightsToLookUp(drafts, said = '') {
  const heard = squash(said);
  return (Array.isArray(drafts) ? drafts : []).map((r, index) => {
    if (!r || r.category !== 'transport' || r.subtype !== 'flight') return null;
    const d = r.details || {};
    const from = Array.isArray(r._from) && r._from.length ? r._from.slice(0, 4) : clip(d.from, 60);
    const to = Array.isArray(r._to) && r._to.length ? r._to.slice(0, 4) : clip(d.to, 60);
    if (!from || !to || !DAY.test(r.day || '')) return null;
    const code = squash(d.code).slice(0, 8);
    return {
      index,
      from,
      to,
      date: r.day,
      near: TIME.test(r.start_time || '') ? r.start_time : null,
      kind: r._kind === 'outbound' || r._kind === 'return' ? r._kind : 'hop',
      code,
      trusted: !!code && (!!clip(r.booking_ref, 120) || heard.includes(code) || r._trusted === true),
    };
  }).filter(Boolean).slice(0, 8);
}

/** Codes or a place in words, as the airports that serve them. */
function endsOf(index, v) {
  if (Array.isArray(v)) return knownCodes(index, v, 4);
  const known = knownCodes(index, [v], 1);
  return known.length ? known : airportsNamed(index, v).map((a) => a.code);
}

/**
 * A flight as written, pinned where it leaves, with both airports' clocks
 * where it had none. What every flight gets, matched or not: the airport
 * table knows where SIN is without asking Google, which is what lets the
 * place check leave flights alone and run beside this one rather than after
 * it (checkNewEntries, lib/entryChecks.js). Their words, times and number
 * are kept as they are. Null when the airport it leaves from is unknown.
 */
function atAirport(index, draft, t) {
  const a = airportOf(index, endsOf(index, t.from)[0]);
  const b = airportOf(index, endsOf(index, t.to)[0]);
  if (!a) return null;
  const d = withoutHints(draft);
  const details = { ...(d.details || {}) };
  if (!details.departure_timezone) details.departure_timezone = a.tz;
  if (b && !details.arrival_timezone) details.arrival_timezone = b.tz;
  if (b && details.to && !details._arrive) details._arrive = { q: details.to, lat: b.lat, lng: b.lng };
  const pinned = Number.isFinite(d.lat) && Number.isFinite(d.lng);
  return {
    ...d,
    details,
    location: d.location || a.name,
    lat: pinned ? d.lat : a.lat,
    lng: pinned ? d.lng : a.lng,
  };
}

/**
 * Drafts in, `{ groups, found, matched, why }` out. `groups[i]` is what
 * replaces `drafts[i]`: the draft as it was (a flight pinned at its airport),
 * or its real flight a leg each, and `found[i]` says which. The first leg keeps the draft's own fields (its
 * booking reference, its notes when booked); the last keeps its title, which
 * names where the journey ends ("Flight to Sapporo", "Flight home"); the legs
 * between are named for where they land.
 *
 * `country` prices every search in one market (the traveller's), rather than
 * each departure airport's. `search` and `index` are for the tests: a search
 * passed in runs without a key.
 */
export async function findRealFlights(drafts, {
  said = '', currency = 'USD', userId = '', country = '', search = searchOffers, index: given = null,
} = {}) {
  const list = Array.isArray(drafts) ? drafts : [];
  const groups = list.map((d) => [withoutHints(d)]);
  const found = list.map(() => false);
  const done = (why, matched = 0) => ({ groups, found, matched, why });
  const targets = flightsToLookUp(list, said);
  if (!targets.length) return done(null);
  let index;
  try { index = given || await airports(); } catch (e) {
    console.error('[flights] airport table failed to load:', e.message);
    return done('error');
  }
  // Pinned at the airport first, so even a flight with no match needs no place lookup.
  targets.forEach((t) => {
    const pinned = atAirport(index, list[t.index], t);
    if (pinned) groups[t.index] = [pinned];
  });
  // Without a key the real search cannot run; a search passed in (the tests') can.
  if (search === searchOffers && !flightsConfigured()) return done('no_key');
  if (!spendSearches(userId, targets.length)) return done('busy');
  const cur = /^[A-Z]{3}$/.test(currency || '') ? currency : 'USD';
  let matched = 0;
  await Promise.all(targets.map(async (t) => {
    const from = endsOf(index, t.from);
    const to = endsOf(index, t.to);
    if (!from.length || !to.length) return;
    try {
      const offers = await search({
        from,
        to,
        date: t.date,
        currency: cur,
        country: country || (airportOf(index, from[0]) || {}).country || '',
      });
      const named = t.code ? pickOffer(offers, { code: t.code }) : null;
      const offer = named || (t.trusted ? null : pickOffer(offers, { kind: t.kind, near: t.near }));
      if (!offer) return;
      const booked = !!(named && t.trusted);
      const draft = withoutHints(list[t.index]);
      const legs = offerActivities(offer, index, { booked, homeward: t.kind === 'return' });
      const last = legs.length - 1;
      groups[t.index] = legs.map((leg, k) => ({
        ...(k === 0 ? draft : {}),
        ...leg,
        ...(k === last && draft.title ? { title: draft.title } : {}),
        // Theirs, not ours: their reference, and what they paid for a booking.
        ...(k === 0 ? { booking_ref: draft.booking_ref || '' } : {}),
        ...(k === 0 && booked && draft.cost ? { cost: draft.cost } : {}),
      }));
      found[t.index] = true;
      matched += 1;
    } catch (e) {
      console.error('[flights] match failed:', e.message);
    }
  }));
  return done(null, matched);
}

/* ------------------------------------------------------ the editor's --- */

// What a person reads before approving it: the flight, not the intention.
function describeFlight(verb, leg) {
  const d = leg.details || {};
  const who = d.code || d.carrier || 'flight';
  const next = d.arrival_date && d.arrival_date > leg.day ? ' the next day' : '';
  return `${verb} ${who}, ${d.from} ${fmtTime(leg.start_time)} to ${d.to} ${fmtTime(leg.end_time)}${next}`;
}

// The arrival pin is looked up by the trip page; an edit carries only words.
function plainDetails(details) {
  const out = { ...(details || {}) };
  delete out._arrive;
  return out;
}

const set = (v) => v != null && v !== '';

/**
 * The editor's operations with their flights made real (lib/tripEdits.js).
 *
 * A new flight, and a flight an edit moves to another day or time, sets
 * between other airports or turns into a flight, is matched; the matched
 * operation carries the airport's pin (`lat`, `lng`), which the apply step
 * keeps (lib/tripChanges.js). A connection is the first leg in place of the
 * edit and an add for each leg after it. The traveller's own notes, title and
 * cost on an existing flight are left alone.
 */
export async function findRealFlightsForEdits(ops, {
  activities = [], trip = {}, said = '', userId = '', match = findRealFlights,
} = {}) {
  const list = Array.isArray(ops) ? ops : [];
  try {
    const byId = new Map((activities || []).map((a) => [String(a.id), a]));
    const drafts = [];
    const at = [];
    list.forEach((op, i) => {
      let d = null;
      if (op.kind === 'add_activity' && op.category === 'transport' && op.subtype === 'flight') {
        d = {
          day: op.day || trip.start_date, title: op.title, start_time: op.start_time,
          end_time: op.end_time, category: 'transport', subtype: 'flight',
          details: op.details || {}, booking_ref: '', cost: op.cost, notes: op.notes,
          location: op.location,
        };
      } else if (op.kind === 'update_activity') {
        const cur = byId.get(String(op.activity_id));
        const det = op.details || {};
        const category = op.category || (cur && cur.category);
        const subtype = op.subtype || (cur && cur.subtype);
        const moved = set(op.day) || set(op.start_time) || op.subtype === 'flight'
          || set(det.from) || set(det.to) || set(det.code);
        if (cur && moved && category === 'transport' && subtype === 'flight') {
          const details = {
            ...(cur.details || {}),
            ...Object.fromEntries(Object.entries(det).filter(([, v]) => set(v))),
          };
          /*
           * The flight already there is theirs when only its day moves: that
           * number on the new day, or nothing. A new time or new airports
           * means another flight, so its old number is no guide to which.
           */
          const another = !set(det.code) && (set(op.start_time) || set(det.from) || set(det.to));
          if (another) { delete details.code; delete details.carrier; }
          d = {
            ...cur,
            day: op.day || cur.day,
            start_time: op.start_time || cur.start_time,
            end_time: op.end_time || cur.end_time,
            category,
            subtype,
            details,
            _trusted: !set(det.code) && !another && !!details.code,
          };
        }
      }
      if (d) { drafts.push(d); at.push(i); }
    });
    if (!drafts.length) return list;

    const currency = /^[A-Z]{3}$/.test(trip.currency || '') ? trip.currency : 'USD';
    const { groups, found } = await match(drafts, { said, currency, userId });
    const swap = new Map(at.map((i, k) => [i, found && found[k] ? groups[k] : null]));
    const out = [];
    list.forEach((op, i) => {
      const legs = swap.get(i);
      if (!legs || !legs.length) { out.push(op); return; }
      legs.forEach((leg, k) => {
        const flight = {
          day: leg.day,
          start_time: leg.start_time,
          end_time: leg.end_time,
          category: 'transport',
          subtype: 'flight',
          details: plainDetails(leg.details),
          location: leg.location,
          lat: leg.lat,
          lng: leg.lng,
        };
        if (k === 0 && op.kind === 'update_activity') {
          out.push({
            ...op, ...flight, ...(leg.cost ? { cost: leg.cost } : {}), describe: describeFlight('Change to', leg),
          });
          return;
        }
        const base = k === 0 ? op : Object.fromEntries(Object.keys(op).map((key) => [key, null]));
        out.push({
          ...base,
          ...flight,
          kind: 'add_activity',
          activity_id: null,
          title: leg.title,
          cost: leg.cost,
          notes: leg.notes,
          named_place: false,
          items: null,
          describe: describeFlight('Add', leg),
        });
      });
    });
    return out;
  } catch (e) {
    console.error('[flights] could not match the edit\'s flights:', (e && e.message) || e);
    return list;
  }
}
