import { LODGING_KEYS, cleanLodging, moveStay } from './lodging.js';

/**
 * Carrying out edits a traveller has approved.
 *
 * The editor (lib/tripEdits.js) proposes; this is what happens after the
 * Apply button, wherever it was pressed — the command bar or a chat with the
 * Assistant. One path, so an edit lands the same way from either, and nothing
 * here runs before someone has seen the list.
 */

/**
 * The keys that were actually set, out of a shape that always carries all.
 *
 * Strict schemas require every property, so a request to set one gate arrives
 * with eleven nulls beside it. Writing those through would blank fields nobody
 * asked about.
 */
export function onlySet(details) {
  if (!details || typeof details !== 'object') return {};
  return Object.entries(details).reduce((o, [k, v]) => {
    const val = String(v == null ? '' : v).trim();
    return val || (LODGING_KEYS.includes(k) && v === '') ? { ...o, [k]: val } : o;
  }, {});
}

/** Nudge a HH:MM by some minutes, staying inside the day. */
export function shiftTime(t, minutes) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  // Clamped rather than rolled over: a stop that silently moves to tomorrow is
  // a worse surprise than one pinned to the end of today.
  const total = Math.max(0, Math.min(23 * 60 + 59, (h * 60) + m + minutes));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * Bulk operations name an intent; this turns one into the edits that carry it
 * out. Doing the expansion here rather than asking the model to enumerate it
 * is the difference between one operation and fifty — and fifty was what kept
 * running long requests out of room.
 */
export function expand(op, activities) {
  const onDay = (day) => activities.filter((a) => a.day === day);

  if (op.kind === 'shift_times') {
    const scope = op.day ? onDay(op.day) : activities;
    const by = op.minutes || 0;
    if (!by) return [];
    return scope
      .filter((a) => a.start_time || a.end_time)
      .map((a) => ({
        kind: 'update_activity',
        activity_id: a.id,
        start_time: shiftTime(a.start_time, by),
        end_time: shiftTime(a.end_time, by),
      }));
  }

  if (op.kind === 'clear_day') {
    return onDay(op.day).map((a) => ({ kind: 'delete_activity', activity_id: a.id }));
  }

  if (op.kind === 'edit_many') {
    return (op.items || []).map((it) => {
      const target = activities.find((a) => String(a.id) === String(it.activity_id));
      if (!target) return null;
      let notes = null;
      if (it.note_add) {
        /*
         * Appended, never substituted. The model is not told what an activity
         * already says, so letting it write the notes field outright would
         * quietly replace whatever was there — and "add the train line" is not
         * a request to delete the booking reference someone typed last week.
         */
        const had = (target.notes || '').trim();
        const line = it.note_add.trim();
        notes = !had ? line : had.includes(line) ? had : [had, line].join('\n');
      }
      return {
        kind: 'update_activity',
        activity_id: it.activity_id,
        notes,
        start_time: it.start_time || null,
        end_time: it.end_time || null,
        cost: it.cost == null ? null : it.cost,
        subtype: it.subtype || null,
        details: it.details || null,
      };
    }).filter(Boolean);
  }

  if (op.kind === 'move_day') {
    if (!op.to_day) return [];
    return onDay(op.day)
      .map((a) => ({ kind: 'move_activity', activity_id: a.id, day: op.to_day }));
  }

  return [op];
}

/** Every proposed operation, as the single edits it lands on. */
export function expandAll(ops, activities) {
  return (ops || []).flatMap((o) => expand(o, activities));
}

/**
 * The new and changed places among some edits, to be looked up before
 * anything is saved, and the destination to look them up near.
 */
export function placeTargets(expanded, activities, trip) {
  const byId = new Map(activities.map((a) => [String(a.id), a]));
  let destination = (trip && trip.destination) || '';
  expanded.forEach((op) => {
    if (op.kind === 'update_trip' && op.destination != null) destination = op.destination;
  });

  const targets = [];
  expanded.forEach((op, opIndex) => {
    let target;
    if (op.kind === 'add_activity') {
      target = {
        id: `op-${opIndex}`, query: op.location, title: op.title,
        category: op.category, day: op.day || trip.start_date,
      };
    } else if (op.kind === 'update_activity' && op.location != null) {
      const current = byId.get(String(op.activity_id));
      const changed = current && String(op.location || '').trim().toLowerCase()
        !== String(current.location || '').trim().toLowerCase();
      if (changed) {
        target = {
          id: `op-${opIndex}`, query: op.location, title: op.title || current.title,
          category: op.category || current.category, day: op.day || current.day,
        };
      }
    }
    if (target && String(target.query || '').trim()) targets.push(target);
  });
  return { targets, destination };
}

/**
 * What the place lookup came back with: the places it was sure of, and the
 * ones with several plausible matches that a person has to choose between.
 */
export function sortPlaces(results, targets) {
  const resolved = {};
  const uncertain = [];
  (results || []).forEach((result) => {
    if (!result.found) {
      resolved[result.id] = null;
      return;
    }
    const request = targets.find((item) => item.id === result.id);
    if (result.ambiguous && Array.isArray(result.candidates) && result.candidates.length) {
      uncertain.push({
        id: result.id,
        title: request ? request.title : 'Activity',
        query: request ? request.query : '',
        reason: result.resolution_reason || '',
        candidates: result.candidates,
      });
    } else {
      resolved[result.id] = result;
    }
  });
  return { resolved, uncertain };
}

/** The places someone chose, folded into the ones that were already sure. */
export function withChosenPlaces(resolved, items, selected) {
  const out = { ...resolved };
  items.forEach((item) => {
    const choice = selected[item.id];
    out[item.id] = choice === '__none__'
      ? null : item.candidates.find((candidate) => candidate.place_id === choice) || null;
  });
  return out;
}

/**
 * Write a fully reviewed proposal. No trip mutation happens before this.
 *
 * `api` is the trip's own save functions (TripProvider): addActivities,
 * updateTrip, deleteActivity, moveActivity, saveActivity. Resolves to how many
 * changes were made.
 */
export async function applyChanges({
  expanded, resolved = {}, activities, trip, api,
}) {
  const byId = new Map(activities.map((a) => [String(a.id), a]));
  const additions = [];
  let done = 0;

  for (let opIndex = 0; opIndex < expanded.length; opIndex += 1) {
    const op = expanded[opIndex];
    const place = resolved[`op-${opIndex}`];
    if (op.kind === 'add_activity') {
      additions.push({
        day: op.day || trip.start_date,
        title: op.title || 'Untitled',
        start_time: op.start_time,
        end_time: op.end_time,
        category: op.category || 'sightseeing',
        subtype: op.category === 'transport' ? op.subtype || null : null,
        details: op.category === 'lodging' ? cleanLodging({ check_in_date: '', ...onlySet(op.details) })
          : op.category === 'transport' ? onlySet(op.details) : {},
        location: (place && place.label) || op.location || '',
        lat: place ? place.lat : null,
        lng: place ? place.lng : null,
        place_id: place ? place.place_id : null,
        photo_ref: place ? place.photo_ref : null,
        cost: op.cost || 0,
        notes: op.notes || '',
      });
      done += 1;
    } else if (op.kind === 'update_trip') {
      const patch = {};
      if (op.trip_name) patch.name = op.trip_name;
      if (op.destination != null) patch.destination = op.destination;
      if (op.start_date) patch.start_date = op.start_date;
      if (op.end_date) patch.end_date = op.end_date;
      if (op.currency) patch.currency = op.currency;
      if (op.timezone) patch.timezone = op.timezone;
      if (op.budget != null) patch.budget = op.budget;
      if (Object.keys(patch).length) {
        await api.updateTrip(patch); // eslint-disable-line no-await-in-loop
        done += 1;
      }
    } else {
      const target = byId.get(String(op.activity_id));
      if (!target) continue;
      if (op.kind === 'delete_activity') {
        await api.deleteActivity(target); // eslint-disable-line no-await-in-loop
      } else if (op.kind === 'move_activity') {
        await api.moveActivity(target, op.day); // eslint-disable-line no-await-in-loop
      } else {
        const patch = { ...target };
        if (op.title != null) patch.title = op.title;
        if (op.start_time !== null) patch.start_time = op.start_time;
        if (op.end_time !== null) patch.end_time = op.end_time;
        if (op.category != null) patch.category = op.category;
        if (op.subtype != null) patch.subtype = op.subtype;
        /*
         * Merged, not replaced. Setting the gate on a flight should not
         * wipe the seat number somebody typed last week, and the model is
         * only ever told to send what it means to change.
         */
        if (op.details) {
          patch.details = { ...(target.details || {}), ...onlySet(op.details) };
        }
        if (op.location != null) {
          const changed = String(op.location || '').trim().toLowerCase()
            !== String(target.location || '').trim().toLowerCase();
          patch.location = op.location;
          if (changed) {
            // An address and its pin are one fact. Keeping the old pin
            // after changing only the text makes the map confidently wrong.
            patch.lat = null;
            patch.lng = null;
            patch.place_id = null;
            patch.photo_ref = null;
            if (place) {
              patch.lat = place.lat;
              patch.lng = place.lng;
              patch.place_id = place.place_id || null;
              patch.photo_ref = place.photo_ref || null;
              patch.location = place.label || op.location;
            }
          }
        }
        if (op.cost != null) patch.cost = op.cost;
        if (op.notes != null) patch.notes = op.notes;
        if (op.day) {
          patch.day = op.day;
          if (!op.details) Object.assign(patch, moveStay(target, op.day));
        }
        await api.saveActivity(patch); // eslint-disable-line no-await-in-loop
      }
      done += 1;
    }
  }

  if (additions.length) await api.addActivities(additions);
  return done;
}
