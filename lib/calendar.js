// Date-only arithmetic stays in UTC, independent of the browser's time zone.
export function dateISO(date) { return date.toISOString().slice(0, 10); }
export function calendarDate(iso) { return new Date(`${iso}T12:00:00Z`); }
export function offsetDate(iso, days) {
  const date = calendarDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return dateISO(date);
}
export function offsetMonth(iso, months) {
  const date = calendarDate(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return dateISO(date);
}
export function calendarDays(month) {
  const first = `${month.slice(0, 7)}-01`;
  const start = offsetDate(first, -calendarDate(first).getUTCDay());
  return Array.from({ length: 42 }, (_, i) => offsetDate(start, i));
}
export function clampDate(date, min, max) {
  return min && date < min ? min : max && date > max ? max : date;
}
export function dateLabel(iso, long = false) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC',
    ...(long ? { weekday: 'long' } : {}),
  }).format(calendarDate(iso));
}
