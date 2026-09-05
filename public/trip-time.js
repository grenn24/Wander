// Shared with the downloaded-trip viewer, which runs without Next or a login.
export function validZone(value) {
  if (!value || typeof value !== 'string') return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
  catch { return false; }
}

export function clockAt(zone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(validZone(zone) ? { timeZone: zone } : {}),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// Resolve a local wall clock against IANA rules, including DST. Reject missing
// spring-forward times instead of quietly scheduling them an hour later.
export function instantAt(day, time, zone) {
  if (!validZone(zone) || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')
      || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time || '')) return null;
  const target = Date.parse(`${day}T${time.slice(0, 5)}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== day) return null;
  let guess = target;
  for (let i = 0; i < 4; i += 1) {
    const local = clockAt(zone, new Date(guess));
    const shown = Date.parse(`${local.day}T00:00:00Z`) + local.minutes * 60000;
    if (shown === target) return guess;
    guess += target - shown;
  }
  return null;
}

export function nextDate(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

export function activityTimes(activity, zone) {
  const a = activity;
  const flight = a.category === 'transport' && a.subtype === 'flight';
  const d = a.details || {};
  const startZone = flight ? d.departure_timezone : zone;
  const endZone = flight ? d.arrival_timezone : zone;
  if (!validZone(startZone) || (a.end_time && !validZone(endZone))) {
    throw new Error(flight ? 'Set the flight departure and arrival time zones.' : 'Set the destination time zone in trip settings.');
  }
  const start = instantAt(a.day, a.start_time, startZone);
  if (start == null) throw new Error('Check the start date and time; this local time may not exist because the clocks change.');
  let endDay = flight ? d.arrival_date : a.day;
  if (flight && a.end_time && !endDay) throw new Error('Set the flight arrival date.');
  let end = a.end_time ? instantAt(endDay, a.end_time, endZone) : start + 3600000;
  // Overnight ordinary activities are allowed; flight dates must be explicit,
  // since crossing the date line can even mean arriving on the previous date.
  if (!flight && end != null && end <= start) {
    endDay = nextDate(a.day);
    end = instantAt(endDay, a.end_time, zone);
  }
  if (end == null || end <= start) throw new Error('Arrival must be after departure. Check the dates, times and time zones.');
  return { start, end, startZone, endZone: a.end_time ? endZone : startZone };
}

export function tripNow(trip, activities, date = new Date()) {
  const clock = clockAt(trip.timezone, date);
  const live = !!(trip.start_date && clock.day >= trip.start_date && clock.day <= trip.end_date);
  const day = live ? clock.day : trip.start_date;
  const nowMs = date.getTime();
  const list = activities.filter((a) => a.day === day).slice().sort((a, b) =>
    (a.start_time || '99').localeCompare(b.start_time || '99') || (a.sort_order || 0) - (b.sort_order || 0));
  if (!live) return { ...clock, day, live, now: null, next: list[0] || null, minutesUntil: null };
  const timed = activities.flatMap((a) => {
    if (!a.start_time) return [];
    try { return [{ activity: a, ...activityTimes(a, trip.timezone) }]; } catch { return []; }
  }).sort((a, b) => a.start - b.start);
  timed.forEach((entry, i) => {
    const a = entry.activity;
    if (a.end_time || a.subtype === 'flight') return;
    const next = timed.slice(i + 1).find((other) => other.activity.day === a.day && other.start > entry.start);
    // Keep the existing day behaviour for an activity without an end time.
    entry.end = next?.start ?? instantAt(nextDate(a.day), '00:00', trip.timezone) ?? entry.end;
  });
  const current = timed.find((a) => a.start <= nowMs && a.end > nowMs);
  const upcoming = timed.find((a) => a.start > nowMs && clockAt(trip.timezone, new Date(a.start)).day === clock.day);
  return { ...clock, day, live, now: current?.activity || null,
    next: upcoming?.activity || (list.every((a) => !a.start_time) ? list[0] : null),
    minutesUntil: upcoming ? Math.ceil((upcoming.start - nowMs) / 60000) : null };
}
