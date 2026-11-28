'use client';
import { authHeader } from './supabase.js';
import { pinQueries, applyPins } from './geo.js';

/*
 * The two checks every new entry goes through before it is saved, as the
 * browser asks for them: real flights (fetchRealFlights, /api/flights) and
 * exact places (fetchExactPlaces, /api/places/resolve), or both at once
 * (checkNewEntries). The trip editor (command bar, Assistant) uses the same
 * two services in its own order: flights in the server before it proposes
 * (lib/tripEdits.js), places on Apply (components/useApplyChanges.js).
 */

/**
 * Put each new entry on its exact spot before it is written.
 *
 * The words a model chooses ("Ralph Lauren Ginza, Ginza, Tokyo") are a search,
 * not an address. Google's answer is the address: the entry leaves here with
 * its street address in `location`, its pin and its photo, so it is right the
 * first time it is drawn.
 *
 * Each place goes with its name, kind and day, so a chain resolves to the
 * branch that fits, and an uncertain match gets the same second opinion the
 * planner and the command bar use.
 *
 * Never throws. Whatever cannot be found is returned as it came.
 */
export async function fetchExactPlaces(drafts, bias = '') {
  const list = Array.isArray(drafts) ? drafts : [];
  const items = pinQueries(list);
  if (!items.length) return list;
  try {
    const res = await fetch('/api/places/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ items, bias, reviewAmbiguous: true }),
    });
    if (!res.ok) return list;
    const { results } = await res.json();
    return applyPins(list, results);
  } catch {
    return list;
  }
}

const isFlight = (d) => !!d && d.category === 'transport' && d.subtype === 'flight';

/**
 * New entries with their flights made real, through the same service the
 * trip editor uses in the server (findRealFlights, lib/realFlights.js, behind
 * /api/flights). `groups[i]` replaces `drafts[i]`: itself, or its real flight
 * a leg each. `said` is what the traveller wrote, so the flight numbers in it
 * are held to.
 *
 * Asks nothing when there is no flight among them, and never throws.
 */
export async function fetchRealFlights(drafts, { said = '', currency = '', signal } = {}) {
  const list = Array.isArray(drafts) ? drafts : [];
  const same = list.map((d) => [d]);
  if (!list.some(isFlight)) return same;
  try {
    const res = await fetch('/api/flights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ mode: 'legs', rows: list, said, currency }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return same;
    const { groups } = await res.json();
    return Array.isArray(groups) && groups.length === list.length
      && groups.every((g) => Array.isArray(g) && g.length) ? groups : same;
  } catch (e) {
    if (signal && signal.aborted) throw e;
    return same;
  }
}

/**
 * Both checks every new entry goes through before it is written, for the
 * pages that make entries (quick add, suggestions), at the same time: the
 * flights to the flight check, everything else to the place check. They never
 * touch the same entry, because the flight check pins each flight at its
 * airport itself (lib/realFlights.js), so neither waits for the other.
 *
 * A flight the flight check cannot read at all (no airport it knows) comes
 * back unpinned, and only those are then looked up as places.
 */
export async function checkNewEntries(drafts, { bias = '', said = '', currency = '' } = {}) {
  const list = Array.isArray(drafts) ? drafts : [];
  const flights = [];
  const others = [];
  list.forEach((d, i) => (isFlight(d) ? flights : others).push(i));
  const [groups, placed] = await Promise.all([
    fetchRealFlights(flights.map((i) => list[i]), { said, currency }),
    fetchExactPlaces(others.map((i) => list[i]), bias),
  ]);
  const slots = new Array(list.length);
  flights.forEach((i, k) => { slots[i] = groups[k]; });
  others.forEach((i, k) => { slots[i] = [placed[k]]; });
  const out = slots.flat();
  const stray = out.map((d, i) => (isFlight(d) && d.lat == null && String(d.location || '').trim() ? i : -1))
    .filter((i) => i >= 0);
  if (!stray.length) return out;
  const found = await fetchExactPlaces(stray.map((i) => out[i]), bias);
  stray.forEach((i, k) => { out[i] = found[k]; });
  return out;
}
