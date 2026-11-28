/**
 * Making the hotels in new entries real: the third shared check, beside real
 * flights (lib/realFlights.js) and exact places (lib/places.js).
 *
 * Whatever writes a stay — the planner, the command bar, the Assistant —
 * writes a hotel's name and the nights. This finds that hotel on Google
 * Hotels for those dates (lib/hotels.js) and gives the stay its real pin, its
 * own check-in and check-out times and, unless it is booked, the rate.
 *
 *   findRealStays          entries in, the same entries out. Called through
 *                          /api/stays by the pages (fetchRealStays,
 *                          lib/entryChecks.js), at the same time as the other
 *                          two checks.
 *   findRealStaysForEdits  the same for the editor's proposed changes, run in
 *                          the server before the proposal is shown
 *                          (lib/tripEdits.js).
 *
 * Never throws, and never swaps one hotel for another: a hotel that cannot be
 * found by its name is kept as written, and the place check pins it.
 */
import { searchHotels, pickHotel, stayWithHotel, nightsBetween } from './hotels.js';
import { serpConfigured, spendSearches } from './serpApi.js';
import { money } from './util.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/** "Hotel Gracery, Kabukicho, Shinjuku City, Tokyo" -> "Tokyo". */
function cityOf(location) {
  const parts = String(location || '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/**
 * The stays worth a search: a hotel by name with the nights it covers. One
 * with no dates has nothing to price, and goes to the place check alone.
 */
export function staysToLookUp(entries) {
  return (Array.isArray(entries) ? entries : []).map((e, index) => {
    if (!e || e.category !== 'lodging') return null;
    const d = e.details || {};
    const name = clip(e.title, 120);
    const nights = DAY.test(d.check_in_date || '') && DAY.test(d.check_out_date || '')
      ? nightsBetween(d.check_in_date, d.check_out_date) : 0;
    if (!name || !nights) return null;
    const city = cityOf(e.location);
    return {
      index,
      name,
      query: city && !name.toLowerCase().includes(city.toLowerCase()) ? `${name}, ${city}` : name,
      checkIn: d.check_in_date,
      checkOut: d.check_out_date,
      nights,
      booked: !!clip(e.booking_ref, 120),
    };
  }).filter(Boolean).slice(0, 6);
}

/**
 * Entries in, `{ entries, found, matched, why }` out: `entries[i]` is
 * `entries[i]` as it was, or with its hotel made real, and `found[i]` says
 * which. `search` is for the tests: a search passed in runs without a key.
 */
export async function findRealStays(list, {
  currency = 'USD', userId = '', country = '', search = searchHotels,
} = {}) {
  const entries = (Array.isArray(list) ? list : []).slice();
  const found = entries.map(() => false);
  const done = (why, matched = 0) => ({ entries, found, matched, why });
  const targets = staysToLookUp(entries);
  if (!targets.length) return done(null);
  if (search === searchHotels && !serpConfigured()) return done('no_key');
  if (!spendSearches(userId, targets.length)) return done('busy');
  const cur = /^[A-Z]{3}$/.test(currency || '') ? currency : 'USD';
  let matched = 0;
  await Promise.all(targets.map(async (t) => {
    try {
      const hotels = await search({
        query: t.query, checkIn: t.checkIn, checkOut: t.checkOut, currency: cur, country,
      });
      const hotel = pickHotel(hotels, t.name);
      if (!hotel) return;
      entries[t.index] = stayWithHotel(entries[t.index], hotel, {
        currency: cur, nights: t.nights, booked: t.booked,
      });
      found[t.index] = true;
      matched += 1;
    } catch (e) {
      console.error('[stays] match failed:', e.message);
    }
  }));
  return done(null, matched);
}

/* ------------------------------------------------------ the editor's --- */

const set = (v) => v != null && v !== '';

/**
 * The editor's operations with their hotels made real: a new stay with its
 * nights, and a stay an edit moves to other nights or another hotel. The
 * matched operation carries the hotel's pin (`lat`, `lng`), which the apply
 * step keeps (alreadyPinned, lib/tripChanges.js), its times and, for a new
 * stay, its rate. The traveller's own notes on an existing stay are theirs.
 */
export async function findRealStaysForEdits(ops, {
  activities = [], trip = {}, userId = '', match = findRealStays,
} = {}) {
  const list = Array.isArray(ops) ? ops : [];
  try {
    const byId = new Map((activities || []).map((a) => [String(a.id), a]));
    const drafts = [];
    const at = [];
    list.forEach((op, i) => {
      let d = null;
      const det = op.details || {};
      if (op.kind === 'add_activity' && op.category === 'lodging') {
        d = {
          day: op.day, title: op.title, category: 'lodging', location: op.location,
          details: det, cost: op.cost, notes: op.notes, booking_ref: '',
        };
      } else if (op.kind === 'update_activity') {
        const cur = byId.get(String(op.activity_id));
        const category = op.category || (cur && cur.category);
        const changed = set(op.title) || set(op.location) || set(det.check_in_date) || set(det.check_out_date);
        if (cur && category === 'lodging' && changed) {
          d = {
            ...cur,
            title: op.title || cur.title,
            location: op.location || cur.location,
            category,
            details: { ...(cur.details || {}), ...Object.fromEntries(Object.entries(det).filter(([, v]) => set(v))) },
          };
        }
      }
      if (d) { drafts.push(d); at.push(i); }
    });
    if (!drafts.length) return list;

    const currency = /^[A-Z]{3}$/.test(trip.currency || '') ? trip.currency : 'USD';
    const { entries, found } = await match(drafts, { currency, userId });
    const real = new Map(at.map((i, k) => [i, found && found[k] ? { stay: entries[k], was: drafts[k] } : null]));
    return list.map((op, i) => {
      const hit = real.get(i);
      if (!hit) return op;
      const { stay, was } = hit;
      const times = {};
      ['check_in_time', 'check_out_time'].forEach((k) => {
        if (stay.details[k] && stay.details[k] !== (was.details || {})[k]) times[k] = stay.details[k];
      });
      const pinned = {
        ...op,
        location: stay.location || op.location,
        lat: stay.lat,
        lng: stay.lng,
        details: { ...(op.details || {}), ...times },
      };
      if (op.kind !== 'add_activity') return pinned;
      const nights = staysToLookUp([stay])[0];
      return {
        ...pinned,
        cost: stay.cost,
        notes: stay.notes,
        describe: `Add ${stay.title}, ${nights ? `${nights.nights} night${nights.nights === 1 ? '' : 's'}` : 'a stay'}`
          + `${stay.cost ? `, about ${money(stay.cost, currency)}` : ''}`,
      };
    });
  } catch (e) {
    console.error('[stays] could not match the edit\'s hotels:', (e && e.message) || e);
    return list;
  }
}
