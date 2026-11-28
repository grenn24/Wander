'use client';
import { authHeader } from '@/lib/supabase';
import { pinQueries, applyPins } from '@/lib/geo';

/*
 * The checks every new entry goes through before it is saved, for the pages
 * that make them in the browser. The trip editor (command bar, Assistant)
 * runs the same two services in its own path: flights in the server before
 * it proposes (lib/tripEdits.js), places on Apply (components/useTripChanges.js).
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
export async function pinPlaces(drafts, bias = '') {
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
 * trip editor uses in the server (matchFlights, lib/flightMatch.js, behind
 * /api/flights). `groups[i]` replaces `drafts[i]`: itself, or its real flight
 * a leg each. `said` is what the traveller wrote, so the flight numbers in it
 * are held to.
 *
 * Asks nothing when there is no flight among them, and never throws.
 */
export async function flightGroups(drafts, { said = '', currency = '', signal } = {}) {
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
 * Everything a new entry is checked against before it is written, in one
 * call for the pages that make entries (quick add, suggestions): its flight
 * made real, then its place pinned. A flight leg is already pinned at its
 * airport, so the place lookup passes it by.
 */
export async function settleDrafts(drafts, { bias = '', said = '', currency = '' } = {}) {
  const groups = await flightGroups(drafts, { said, currency });
  return pinPlaces(groups.flat(), bias);
}
