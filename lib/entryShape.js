import { TRANSPORT, transportOf } from './transport.js';
import { LODGING_KEYS, cleanLodging, lodgingPayload } from './lodging.js';

/**
 * What an entry is allowed to hold, decided once for every way of making one.
 *
 * Each writer (the planner, the trip editor behind the command bar and the
 * Assistant, quick add) used to carry its own copy of the details schema and
 * its own sanitiser, and the copies drifted: the planner kept only the fields
 * a kind of journey has, the editor kept any field any kind has (so an edit
 * could put a gate on a bus), and quick add had a third set of rules. A new
 * field had to be added in each, and the one forgotten looked exactly like
 * the model ignoring the request (HANDOVER, bug classes 1 and 3).
 *
 * So: one schema fragment for the models (detailsSchema), one sanitiser for
 * what they send back (cleanDetails), and one shape for the row that is saved
 * (activityRow), here.
 */

export const TRANSPORT_IDS = TRANSPORT.map((t) => t.id);

/** Every field any entry can hold in `details`, from the app's own tables. */
export const DETAIL_KEYS = [...new Set([...TRANSPORT.flatMap((t) => t.fields.map((f) => f.k)), ...LODGING_KEYS])];

/*
 * A journey whose kind is not known still has two ends; anything more (a
 * gate, a platform, a pier) belongs to one kind and is kept only once the
 * kind is known.
 */
const ANY_JOURNEY = ['from', 'to'];

/**
 * The `details` part of a strict structured-output schema. Strict mode
 * requires every property, so each is a string or null. `keys` narrows it
 * (quick add asks for four), `describe` gives a field its own description,
 * and `nullable` lets the whole object be null ("leave details alone").
 */
export function detailsSchema({
  keys = DETAIL_KEYS, nullable = false, describe = {}, description = '',
} = {}) {
  return {
    type: nullable ? ['object', 'null'] : 'object',
    additionalProperties: false,
    required: keys,
    ...(description ? { description } : {}),
    properties: keys.reduce((o, k) => ({
      ...o,
      [k]: { type: ['string', 'null'], ...(describe[k] ? { description: describe[k] } : {}) },
    }), {}),
  };
}

/** The fields an entry of this category and kind can hold. */
export function detailKeysFor(category, subtype) {
  if (category === 'lodging') return LODGING_KEYS;
  if (category !== 'transport') return [];
  const mode = transportOf(subtype);
  return mode ? mode.fields.map((f) => f.k) : ANY_JOURNEY;
}

/**
 * What a model wrote in `details`, kept only where this kind of entry has
 * that field and only where something was written: a flight keeps its gate,
 * a bus has none to keep, a dinner keeps nothing.
 *
 * A stay's dates and times are checked as dates and times (cleanLodging),
 * unless `clearing`: an edit may send '' to clear one, and that must reach
 * the save as ''. `only` narrows the fields further (quick add's four).
 */
export function cleanDetails(category, subtype, details, { only = null, clearing = false } = {}) {
  const src = details && typeof details === 'object' ? details : {};
  if (category === 'lodging' && !clearing) return cleanLodging(src);
  const allowed = new Set(detailKeysFor(category, subtype).filter((k) => !only || only.includes(k)));
  return Object.entries(src).reduce((o, [k, v]) => {
    if (!allowed.has(k)) return o;
    const val = String(v == null ? '' : v).trim().slice(0, 120);
    return val || (clearing && LODGING_KEYS.includes(k) && v === '') ? { ...o, [k]: val } : o;
  }, {});
}

const point = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * An entry as the row the activities table keeps, however it was made: the
 * planner's save, a quick add, the editor's Apply, the activity form. The
 * trip and the sort order are the caller's to add.
 *
 * Only transport has a kind, and only a kind has fields, so anything else
 * carrying one is a leftover from a category change and is cleared. A stay
 * with dates is placed on its check-in day (lodgingPayload).
 */
export function activityRow(draft) {
  const d = draft || {};
  const cost = Number(d.cost || 0);
  return {
    day: d.day,
    title: String(d.title || '').trim() || 'Untitled',
    start_time: d.start_time || null,
    end_time: d.end_time || null,
    category: d.category || 'sightseeing',
    location: d.location || '',
    lat: point(d.lat),
    lng: point(d.lng),
    cost: Number.isFinite(cost) ? cost : 0,
    subtype: d.category === 'transport' ? d.subtype || null : null,
    details: d.category === 'transport' && d.details ? d.details : {},
    ...lodgingPayload(d),
    booking_ref: d.booking_ref || '',
    notes: d.notes || '',
    // A place found by any means keeps its identity, not just its pin.
    place_id: d.place_id || null,
    photo_ref: d.photo_ref || null,
  };
}
