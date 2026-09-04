// A booking is stored once. Its itinerary entries are views, never extra rows.
export const LODGING_KEYS = ['check_in_date', 'check_out_date', 'check_in_time', 'check_out_time'];

export function validStayDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function cleanLodging(details) {
  if (!details || !LODGING_KEYS.some((k) => Object.hasOwn(details, k))) return {};
  return Object.fromEntries(LODGING_KEYS.map((k) => [k,
    (k.endsWith('_date') ? validStayDate(details[k])
      : /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(details[k] || ''))
      ? details[k] : '',
  ]));
}

export function hasStayDates(activity) {
  return activity.category === 'lodging'
    && LODGING_KEYS.some((k) => Object.hasOwn(activity.details || {}, k));
}

export function lodgingError(details) {
  const d = details || {};
  if (d.check_in_date && d.check_out_date) {
    if (d.check_out_date < d.check_in_date) return 'Checkout must be on or after check-in.';
    if (d.check_out_date === d.check_in_date && d.check_in_time && d.check_out_time
      && d.check_out_time < d.check_in_time) return 'Checkout must be after check-in.';
  }
  return '';
}

export function stayOnDay(activity, day) {
  if (!hasStayDates(activity) || lodgingError(activity.details)) return false;
  const d = cleanLodging(activity.details);
  // Checkout day is not another covered night. Endpoints have their own rows.
  return !!(d.check_in_date && d.check_out_date && d.check_in_date < day && day < d.check_out_date);
}

export function itineraryEntries(activities) {
  return activities.flatMap((a) => {
    if (!hasStayDates(a)) return [a]; // Existing, undated lodging stays unchanged.
    const d = cleanLodging(a.details);
    if (lodgingError(d)) return [a];
    return ['check_in', 'check_out'].filter((phase) => d[`${phase}_date`]).map((phase, index) => ({
      ...a, day: d[`${phase}_date`], start_time: d[`${phase}_time`] || null,
      end_time: null, cost: index === 0 ? a.cost : 0,
      _source: a, _phase: phase, _entryId: index === 0 ? a.id : `${a.id}-checkout`,
    }));
  });
}

export function lodgingPayload(draft) {
  if (!hasStayDates(draft)) return {};
  const details = cleanLodging(draft.details);
  return { details, day: details.check_in_date || details.check_out_date || draft.day,
    start_time: (details.check_in_date ? details.check_in_time : details.check_out_time) || null,
    end_time: null };
}

export function moveStay(activity, day) {
  if (!hasStayDates(activity) || !validStayDate(day) || !validStayDate(activity.day)) return {};
  const details = cleanLodging(activity.details);
  const offset = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${activity.day}T00:00:00Z`);
  for (const key of ['check_in_date', 'check_out_date']) {
    if (details[key]) details[key] = new Date(Date.parse(`${details[key]}T00:00:00Z`) + offset).toISOString().slice(0, 10);
  }
  return lodgingPayload({ ...activity, day, details });
}
