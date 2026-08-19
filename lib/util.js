export const CATEGORIES = [
  { id: 'sightseeing', label: 'Sightseeing', icon: '⛰' },
  { id: 'food',        label: 'Food & drink', icon: '\u{1F35C}' },
  { id: 'transport',   label: 'Transport',   icon: '\u{1F686}' },
  { id: 'lodging',     label: 'Lodging',     icon: '\u{1F3E8}' },
  { id: 'activity',    label: 'Activity',    icon: '\u{1F3AB}' },
  { id: 'shopping',    label: 'Shopping',    icon: '\u{1F6CD}' },
  { id: 'other',       label: 'Other',       icon: '•' },
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

const NAME_KEY = 'tp.name';

export function readLocalName() {
  try { return window.localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
}

export function writeLocalName(name) {
  try { window.localStorage.setItem(NAME_KEY, name); } catch (e) { /* ignore */ }
}

export function ensureLocalName() {
  const existing = readLocalName();
  if (existing) return existing;
  const n = `Guest ${String(Math.floor(Math.random() * 9000) + 1000)}`;
  writeLocalName(n);
  return n;
}

export function sortActs(a, b) {
  const at = a.start_time || '99:99';
  const bt = b.start_time || '99:99';
  if (at !== bt) return at < bt ? -1 : 1;
  return (a.sort_order || 0) - (b.sort_order || 0);
}
