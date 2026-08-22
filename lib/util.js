// Icons live in lib/icons.js, keyed by these ids — a <select> cannot render an
// SVG, so the label has to stand on its own here.
export const CATEGORIES = [
  { id: 'sightseeing', label: 'Sightseeing' },
  { id: 'food',        label: 'Food & drink' },
  { id: 'transport',   label: 'Transport' },
  { id: 'lodging',     label: 'Lodging' },
  { id: 'activity',    label: 'Activity' },
  { id: 'shopping',    label: 'Shopping' },
  { id: 'other',       label: 'Other' },
];

export function categoryOf(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

export const CURRENCIES = ['SGD', 'JPY', 'USD', 'EUR', 'GBP', 'AUD', 'MYR', 'THB', 'KRW', 'TWD', 'IDR', 'VND', 'CNY', 'HKD', 'INR', 'NZD', 'CHF', 'CAD'];

export function todayISO() {
  const d = new Date();
  return toISO(d);
}

export function toISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toISO(dt);
}

export function dayRange(start, end) {
  if (!start) return [];
  const out = [];
  let cur = start;
  const last = end && end >= start ? end : start;
  let guard = 0;
  while (cur <= last && guard < 400) { out.push(cur); cur = addDays(cur, 1); guard += 1; }
  return out;
}

export function fmtDay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtDayLong(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hh = Number(h);
  const suffix = hh < 12 ? 'am' : 'pm';
  const base = hh % 12 === 0 ? 12 : hh % 12;
  return m === '00' ? `${base}${suffix}` : `${base}:${m}${suffix}`;
}

export function money(n, currency) {
  const value = Number(n || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currency || 'SGD',
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch (e) {
    return `${currency || ''} ${value.toFixed(2)}`;
  }
}

const AVATAR_HUES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

export function colorFor(str) {
  const s = String(str || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

export function initials(who) {
  const s = String(who || '?').trim();
  const name = s.split('@')[0];
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]);
  return name.slice(0, 2) || '?';
}

export function sortActs(a, b) {
  const at = a.start_time || '99:99';
  const bt = b.start_time || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return (a.sort_order || 0) - (b.sort_order || 0);
}

/* ------------------------------------------------------------ quick add --- */
/**
 * Parse "9am Senso-ji" / "9:30 pm ramen" / "18:40 Shinkansen" into a time plus
 * a title. Deliberately conservative: a bare leading number is left alone so
 * "5 Guys burgers" stays a title rather than becoming 05:00.
 */
export function parseQuickAdd(input) {
  const raw = String(input || '').trim();
  if (!raw) return { title: '', start_time: null };

  const ampm = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b[\s,.\u2013-]*(.*)$/i);
  const h24 = raw.match(/^(\d{1,2}):(\d{2})\b[\s,.\u2013-]*(.*)$/);

  let hh = null;
  let mm = '00';
  let rest = '';
  if (ampm) {
    hh = Number(ampm[1]) % 12;
    mm = ampm[2] || '00';
    rest = ampm[4] || '';
    if (/p/i.test(ampm[3])) hh += 12;
  } else if (h24) {
    hh = Number(h24[1]);
    mm = h24[2];
    rest = h24[3] || '';
  }

  if (hh == null || hh > 23 || Number(mm) > 59 || !rest.trim()) {
    return { title: raw, start_time: null };
  }
  return { title: rest.trim(), start_time: `${String(hh).padStart(2, '0')}:${mm}` };
}

/** Keeps untimed activities in the order they were added, per day. */
export function nextSortOrder(list, day) {
  return (list || [])
    .filter((a) => a.day === day)
    .reduce((max, a) => Math.max(max, Number(a.sort_order) || 0), 0) + 1;
}

/* --------------------------------------------------------------- errors --- */
export function humanError(err) {
  const msg = typeof err === 'string' ? err : (err && err.message) || 'Something went wrong.';
  const m = msg.toLowerCase();
  if (m.includes('share link')) return msg; // already written for humans by the RPC
  if (m.includes('row-level security') || m.includes('permission denied')) {
    return 'You do not have permission to change this trip. Ask the owner for a fresh share link.';
  }
  if (m.includes('jwt') || m.includes('refresh token') || m.includes('not signed in')) {
    return 'Your guest session expired. Reload the page to carry on.';
  }
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  if (m.includes('duplicate key')) return 'That already exists.';
  if (m.includes('foreign key')) return 'That trip no longer exists — it may have been deleted.';
  return msg;
}

/* ----------------------------------------------------------------- dates --- */
export function fmtDayTiny(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * A compact date range in the reader's locale — "Aug 19 – 25" in en-US,
 * "19–25 Aug" in en-GB. Collapsing a range by hand is not safe, because
 * whether the day or the month leads is locale-dependent, so let Intl do it.
 * The year shows only when it is not the current one.
 */
export function fmtRange(start, end) {
  if (!start) return 'no dates';
  const last = end && end >= start ? end : start;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = last.split('-').map(Number);
  const ds = new Date(sy, sm - 1, sd);
  const de = new Date(ey, em - 1, ed);
  const opts = { day: 'numeric', month: 'short' };
  if (sy !== ey || sy !== new Date().getFullYear()) opts.year = 'numeric';

  try {
    const fmt = new Intl.DateTimeFormat(undefined, opts);
    if (start === last) return fmt.format(ds);
    if (typeof fmt.formatRange === 'function') return fmt.formatRange(ds, de);
    return `${fmt.format(ds)} \u2013 ${fmt.format(de)}`;
  } catch (e) {
    return start === last ? start : `${start} \u2013 ${last}`;
  }
}

/** 'current' | 'upcoming' | 'past' | 'undated' */
export function tripStatus(trip, today) {
  const t = today || todayISO();
  if (!trip || !trip.start_date) return 'undated';
  const end = trip.end_date && trip.end_date >= trip.start_date ? trip.end_date : trip.start_date;
  if (end < t) return 'past';
  if (trip.start_date > t) return 'upcoming';
  return 'current';
}

/**
 * Trims a full postal address down to something worth reading in a list.
 * Google returns "1-chome-1-2 Oshiage, Sumida City, Tokyo 131-0045, Japan";
 * at a glance the useful part is "Sumida City, Tokyo".
 */
export function shortPlace(s) {
  const raw = String(s || '').trim();
  if (!raw) return '';
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return parts.join(', ');
  return parts
    .slice(0, -1)                                  // drop the country
    .map((p) => p.replace(/\s+[\d-]{4,}$/, ''))    // drop trailing postcodes
    .filter((p) => p && !/^[\d-]+$/.test(p))       // drop bare numbers
    .slice(-2)
    .join(', ');
}

/** Minutes between two HH:MM strings, or null if either is missing. */
export function minutesBetween(a, b) {
  if (!a || !b) return null;
  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  return toMin(b) - toMin(a);
}

export function fmtDuration(mins) {
  if (mins == null || mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
