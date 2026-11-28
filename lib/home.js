/**
 * Where someone's trips start: their home, and the airports they fly from.
 *
 * Kept on the account itself, in Supabase Auth's user_metadata (`home`), not
 * in a table. It belongs to the person rather than to any trip, only they
 * read or change it, and user_metadata is exactly that: written with their
 * own session (supabase.auth.updateUser), read back on the server from the
 * token they send (userFromRequest). It also needs no migration on the
 * hand-updated production database.
 *
 *   { label: 'Singapore', lat: 1.29, lng: 103.85, airports: ['SIN'] }
 *
 * The planner asks for it the first time it is missing and keeps the answer
 * (app/plan/page.js); the Account page shows and changes it.
 */

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

export function cleanHome(v) {
  if (!v || typeof v !== 'object') return null;
  const label = clip(v.label, 120);
  const lat = Number(v.lat);
  const lng = Number(v.lng);
  const seen = new Set();
  const airports = (Array.isArray(v.airports) ? v.airports : [])
    .map((c) => String(c == null ? '' : c).trim().toUpperCase())
    .filter((c) => /^[A-Z]{3}$/.test(c) && !seen.has(c) && seen.add(c))
    .slice(0, 4);
  if (!label || !airports.length) return null;
  return {
    label,
    ...(Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180
      ? { lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000 } : {}),
    airports,
  };
}

/** The home kept on a Supabase user, or null. */
export function homeOf(user) {
  return cleanHome(user && user.user_metadata && user.user_metadata.home);
}

/** "Singapore" from "Singapore", "Shoreditch, London, UK" -> "Shoreditch". */
export function homeName(home) {
  return home ? clip(String(home.label).split(',')[0], 60) : '';
}
